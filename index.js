'use strict';

var debug   = require('debug')('azurin');
var fs      = require('fs');
var path    = require('path');
var assert  = require('assert');
var request = require('request');
var azure   = require('azure-storage');
var mgmtSQL = require('azure-mgmt-sql');
var mgmtSTG = require('azure-mgmt-storage');

var cloudCredentials, sqlmgmt, storagemgmt;

/**
 * Module entry, set Azure credentials and management clients.
 *
 * @param  {string} certificate    Path to Azure certificate
 * @param  {string} subscriptionId Optionnal Azure subscriptionId, defaults to certificate filename.
 */
module.exports = function (certificate, subscriptionId) {

  if (! certificate) {
    throw Error('Cannot continue without certificate');
  }

  subscriptionId = subscriptionId || path.basename(certificate, '.pem');

  cloudCredentials = mgmtSQL.createCertificateCloudCredentials({
    subscriptionId: subscriptionId,
    pem: fs.readFileSync(certificate)
  });

  sqlmgmt     = mgmtSQL.createSqlManagementClient(cloudCredentials);
  storagemgmt = mgmtSTG.createStorageManagementClient(cloudCredentials);

  return {
    backup: exportToBlob,
    restore: importFromBlob,
    requestStatus: requestStatus,
    waitUntilRequestFinish: waitUntilRequestFinish,
    lastImportInBlobStorage: lastImportInBlobStorage,

    // mainly for tests
    deleteDatabase: deleteDatabase,
    deleteContainer: deleteContainer,
    blobAccountKey: blobAccountKey,
    deleteBlob: deleteBlob
  };
};


/**
 * Export database to a blob storage
 *
 * @param  {object}   db       { server, name, user, password }
 * @param  {object}   blob     { name, accountName, accountKey  }
 * @param  {function} callback callback
 *
 * @return {request}  The underlying request
 */
function exportToBlob (db, blob, callback) {

  debug('will backup ' + db.server + '/' + blob.container + '/' + db.name + ' to ' + blob.accountName + '/' + blob.name);

  function processRequest (error, primaryKey) {

    if (error) {
      debug(error);
      return callback(error);
    }

    if (! primaryKey) {
      debug('cannot process without accountKey');
      return callback(new Error('cannot access storage account'));
    }

    db.user   = db.user.match(/@/) ? db.user : db.user + '@' + db.server;
    db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';
    blob.uri  = (blob.name.match(/^http/)) ? blob.name :
      'https://' + blob.accountName + '.blob.core.windows.net/' + blob.container + '/' +  blob.name;

    var parameters = {
      connectionInfo: {
        databaseName: db.name,
        password:     db.password,
        serverName:   db.server,
        userName:     db.user
      },
      blobCredentials: {
        storageAccessKey: primaryKey,
        uri: blob.uri
      }
    };

    ensureContainerExists(blob.accountName, primaryKey, blob.container, function (error) {
      if (error) return callback(error);
      return sqlmgmt.dac.exportMethod(db.server.split('.')[0], parameters, function(error, result) {

        if (error) {
          debug('backup queuing failed: ' + error);
          return callback(error);
        }

        debug(blob.uri + ' successfully queued. Guid=' + result.guid);
        callback(null, result.guid);
      });
    });
  }

  if (blob.accountKey) {
    processRequest(null, blob.accountKey);
  } else {
    blobAccountKey(blob.accountName, processRequest);
  }
}


/**
 * Import database from a blob storage
 *
 * @param  {object}   db       { server, name, user, password }
 * @param  {object}   blob     { name, accountName, accountKey  }
 * @param  {function} callback callback
 *
 * @return {request}  The underlying request
 */
function importFromBlob (db, blob, callback) {

  debug('will restore ' + blob.accountName + '/' + blob.container + '/' + blob.name + ' to ' + db.server + '/' + db.name);

  assert(blob.name,        'You must provide blob.name');
  assert(blob.accountName, 'You must provide blob.accountName');

  assert(db.name,     'You must provide db.name');
  assert(db.password, 'You must provide db.password');
  assert(db.server,   'You must provide db.server');
  assert(db.user,     'You must provide db.user');

  function processRequest (error, primaryKey) {

    if (error) {
      debug(error);
      return callback(error);
    }

    if (! primaryKey) {
      debug('cannot process without accountKey');
      return callback(new Error('cannot access storage account'));
    }

    db.user   = db.user.match(/@/) ? db.user : db.user + '@' + db.server;
    db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';
    blob.uri  = (blob.name.match(/^http/)) ? blob.name :
      'https://' + blob.accountName + '.blob.core.windows.net/' + blob.container + '/' +  blob.name;

    var parameters = {
      connectionInfo: {
        databaseName: db.name,
        password:     db.password,
        serverName:   db.server,
        userName:     db.user
      },
      azureEdition: db.edition  || 'Business',
      databaseSizeInGB: db.size || 10,
      blobCredentials: {
        storageAccessKey: primaryKey,
        uri: blob.uri
      }
    };

    return sqlmgmt.dac.importMethod(db.server.split('.')[0], parameters, function(error, result) {

      if (error) {
        debug('restore queuing failed: ' + error);
        return callback(error);
      }

      debug(db.name + ' successfully queued. Guid=' + result.guid);
      callback(null, result.guid);
    });
  }

  if (blob.accountKey) {
    processRequest(null, blob.accountKey);
  } else {
    blobAccountKey(blob.accountName, processRequest);
  }
}


function requestStatus (db, guid, callback) {
  db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';
  return sqlmgmt.dac.getStatus(db.server.split('.')[0], db.server, db.user, db.password, guid, function (error, result) {
    if (error || !result.statusInfoList) { return callback(error); }
    callback(error, result.statusInfoList[0]);
  });
}


function waitUntilRequestFinish (db, guid, callback, eachCallback) {
  function retry () {
    requestStatus (db, guid, function (error, req) {

      if (eachCallback) {eachCallback(error, req);}

      // error
      if (error) {
        debug('error: ' + error);
        return callback(error);
      }

      // finished !
      else if (! error && (!req.status || req.status.toLowerCase() === 'completed')) {
        debug('request ' + guid + ' finished');
        return callback(null);
      }

      // still running
      else {
        debug('still ' + req.status.toLowerCase() + (req.errorMessage ? ': ' + req.errorMessage : ''));
        setTimeout(retry, 10 * 1000);
      }
    });
  }
  retry();
}


function sortBlobs (a, b) {
  var aDate = new Date(a.properties['last-modified']).toISOString();
  var bDate = new Date(b.properties['last-modified']).toISOString();
  return aDate > bDate ? 1 : -1;
}


function blobAccountKey (accountName, callback) {

  storagemgmt.storageAccounts.getKeys(accountName, function (err, result) {

    if (err) {
      debug(err);
      return callback(err);
    }

    debug('ask for blob accountKey: ' + accountName + ': ' + result.primaryKey);

    callback(err, result.primaryKey);
  });
}


function lastImportInBlobStorage (account, key, container, callback) {
  var service = azure.createBlobService(account, key);
  service.listBlobsSegmented(container, null, function(error, result, response){
    if (error || !result.entries) { return callback(error); }
    result.entries.sort(sortBlobs);
    callback(null, result.entries.pop());
  });
}


function ensureContainerExists (account, key, container, callback) {
  var service = azure.createBlobService(account, key);
  service.createContainerIfNotExists(container, null, function(error, result, response){
    if (error) { return callback(error); }
    debug('%s container %s', container, result ? 'has been created' : 'already exists');
    callback(null);
  });
}


function deleteDatabase (db, callback) {
  db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';
  sqlmgmt.databases.deleteMethod(db.server.split('.')[0], db.name, function (error, result) {
    if (error) {
      debug('cannot delete database %s: %s', db.name, error);
    } else {
      debug('successfully deleted database %s', db.name);
    }
    callback(error);
  });
}


function deleteBlob (blob, callback) {
  function processRequest (error, accountKey) {
    var service = azure.createBlobService(blob.accountName, accountKey);
    service.deleteBlob(blob.container, blob.name, function (error, result) {
      if (error) {
        debug('cannot delete blob %s/%s: %s', blob.container, blob.name, error);
      } else {
        debug('successfully deleted blob %s/%s', blob.container, blob.name);
      }
      callback(error);
    });
  }

  if (blob.accountKey) {
    processRequest(null, blob.accountKey);
  } else {
    blobAccountKey(blob.accountName, processRequest);
  }
}


function deleteContainer (blob, callback) {
  function processRequest (error, accountKey) {
    var service = azure.createBlobService(blob.accountName, accountKey);
    service.deleteContainer(blob.container, function (error, result) {
      if (error) {
        debug('cannot delete container %s: %s', blob.container, error);
      } else {
        debug('successfully deleted container %s', blob.container);
      }
      callback(error);
    });
  }

  if (blob.accountKey) {
    processRequest(null, blob.accountKey);
  } else {
    blobAccountKey(blob.accountName, processRequest);
  }
}

'use strict';

var debug   = require('debug')('azurin');
var fs      = require('fs');
var _       = require('lodash');
var path    = require('path');
var assert  = require('assert');
var request = require('request');
var async   = require('async');
var moment  = require('moment');
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
    throw Error('Cannot continue without certificate or credentials');
  }

  if (certificate.subscriptionId) {

    cloudCredentials = certificate;
    subscriptionId   = cloudCredentials.subscriptionId;

  } else {

    subscriptionId = subscriptionId || path.basename(certificate, '.pem');

    cloudCredentials = mgmtSQL.createCertificateCloudCredentials({
      subscriptionId: subscriptionId,
      pem: fs.readFileSync(certificate)
    });
  }

  sqlmgmt     = mgmtSQL.createSqlManagementClient(cloudCredentials);
  storagemgmt = mgmtSTG.createStorageManagementClient(cloudCredentials);

  return {
    backup: exportToBlob,
    restore: importFromBlob,
    requestStop: requestStop,
    requestStatus: requestStatus,
    waitUntilRequestFinish: waitUntilRequestFinish,
    lastImportInBlobStorage: lastImportInBlobStorage,
    rotateBackups: rotateBackups,
    deleteBlob: deleteBlob,

    // mainly for tests
    deleteDatabase: deleteDatabase,
    deleteContainer: deleteContainer,
    listContainers: listContainers,
    blobAccountKey: blobAccountKey
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

  debug('will backup ' + db.server + '/' + db.name + ' to ' + blob.accountName + ':' + blob.container + '/' + blob.name);

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

        if (error || ! result) {
          debug('backup queuing failed: %o', error);
          return callback(error);
        }

        debug('%s successfully queued. guid = %o', blob.uri, result.guid);
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

  debug('will restore ' + blob.accountName + ':' + blob.container + '/' + blob.name + ' to ' + db.server + '/' + db.name);

  assert(blob.name,        'You must provide blob.name');
  assert(blob.container,   'You must provide blob.container');
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
      azureEdition: db.edition  || 'Standard',
      databaseSizeInGB: db.size || 20,
      blobCredentials: {
        storageAccessKey: primaryKey,
        uri: blob.uri
      }
    };

    return sqlmgmt.dac.importMethod(db.server.split('.')[0], parameters, function(error, result) {

      if (error || ! result) {
        debug('restore queuing failed: %o', error);
        return callback(error);
      }

      debug(db.name + ' successfully queued. guid = %o', result.guid);
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

function requestStop (db, guid, callback) {
  db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';
  return sqlmgmt.databaseCopies.deleteMethod(db.server.split('.')[0], db.name, guid, function (error, result) {
    if (error || !result) { return callback(error); }
    callback(error, result.statusCode);
  });
}

function waitUntilRequestFinish (db, guid, callback, eachCallback) {
  function retry () {
    requestStatus (db, guid, function (error, req) {

      if (eachCallback) {eachCallback(error, req);}

      // error
      if (error) {
        debug('error: %o', error);
        return callback(error);
      }

      // finished !
      else if (! error && (!req.status || req.status.toLowerCase() === 'completed')) {
        debug('request %o finished', guid);
        return callback(null);
      }

      // finished previously
      else if (req.errorMessage && req.errorMessage.replace(/[\r\n\t]/g, '').match(/it contains one or more user objects/)) {
        debug('request %o finished (destination DB already filled)', guid);
        return callback(null);
      }

      // still running
      else {
        debug('still %o %s', req.status.toLowerCase(), req.errorMessage);
        setTimeout(retry, 10 * 1000);
      }
    });
  }
  retry();
}


function sortBlobs (a, b) {
  var aDate = (a.properties && a.properties['last-modified']) ? a.properties['last-modified'] : a.lastModified;
  var bDate = (b.properties && b.properties['last-modified']) ? b.properties['last-modified'] : b.lastModified;
  var aISOs = new Date(aDate).toISOString();
  var bISOs = new Date(bDate).toISOString();
  return aISOs > bISOs ? 1 : -1;
}


function blobAccountKey (accountName, callback) {

  storagemgmt.storageAccounts.getKeys(accountName, function (err, result) {

    if (err) {
      debug(err);
      return callback(err);
    }

    debug('ask for blob accountKey: %o : %o', accountName, result.primaryKey);

    callback(err, result.primaryKey);
  });
}


function lastImportInBlobStorage (account, key, container, callback) {
  var service = azure.createBlobService(account, key);
  service.listBlobsSegmented(container, null, function(error, result, response){
    if (error || !result.entries) {
      debug(error);
      return callback(error);
    }
    result.entries.sort(sortBlobs);
    callback(null, result.entries.pop());
  });
}


function ensureContainerExists (account, key, container, callback) {
  var service = azure.createBlobService(account, key);
  service.createContainerIfNotExists(container, null, function(error, result, response){
    if (error) {
      debug(error);
      return callback(error);
    }
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

function listContainers(name, key, callback) {
  return azure.createBlobService(name, key).listContainersSegmented(null, callback);
}

function rotateBackupsKeep(name, key, container, options, callback) {
  options       = options       || {};
  options.limit = options.limit || 10;

  var keep = {};

  azure.createBlobService(name, key)
        .listBlobsSegmented(container, null, function (error, result) {
          if (error) return callback(error);
          result.entries.sort(sortBlobs);

          keep.lastEachYear  = _.chain(result.entries).groupBy(byYear).mapValues(takeLastName).values().value();
          keep.lastEachMonth = _.chain(result.entries).groupBy(byMonth).mapValues(takeLastName).values().value();
          keep.last3months   = _.chain(result.entries).filter(testMonthly).map('name').value();
          keep.last10        = _.chain(result.entries).takeRight(options.limit).map('name').value();
          keep.uniques       = _.chain(keep).values().flatten().uniq().value();

          debug('keep %o blobs', keep.uniques.length);
          callback(null, keep);
        });
}

function rotateBackups(name, key, container, options, callback) {
  rotateBackupsKeep(name, key, container, options, function (error, keep) {
    azure.createBlobService(name, key)
          .listBlobsSegmented(container, null, function (error, result) {
            if (error) return callback(error);

            var toDelete = _.chain(result.entries).map('name').difference(keep.uniques).value()

            async.mapLimit(toDelete, 3,
              function (blobName, next) {
                debug('delete %o', blobName);
                deleteBlob({
                  container: container,
                  accountName: name,
                  accountKey: key,
                  name: blobName
                }, next);
              },
              function (error, result) {
                return callback(error, {
                  deleted: toDelete,
                  keep: keep
                });
              });
          });
  });
}



var threeMonthsAgo = moment().subtract(3, 'months');
function byYear(blob) {
  return moment(blob.properties['last-modified']).year();
}
function byMonth(blob) {
  return moment(blob.properties['last-modified']).format('YYYY-MM');
}
function testMonthly(blob) {
  return moment(blob.properties['last-modified']).isAfter(threeMonthsAgo);
}
function takeLastName(blobs) {
  if (blobs.length) return blobs[blobs.length-1].name;
}



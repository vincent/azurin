'use strict';

var debug   = require('debug')('azurin');
var fs      = require('fs');
var path    = require('path');
var assert  = require('assert');
var request = require('request');
var azure   = require('azure-storage');
var mgmtSQL = require('azure-mgmt-sql');
var mgmtSTG = require('azure-mgmt-storage');

var certificate = process.env.AZURE_CERTIFICATE;

var cloudCredentials = mgmtSQL.createCertificateCloudCredentials({
    subscriptionId: path.basename(certificate, '.pem'),
    pem: fs.readFileSync(certificate)
});

var sqlmgmt     = mgmtSQL.createSqlManagementClient(cloudCredentials);
var storagemgmt = mgmtSTG.createStorageManagementClient(cloudCredentials);

module.exports = {
    backup: exportToBlob,
    restore: importFromBlob,
    requestStatus: requestStatus,
    lastImportInBlobStorage: lastImportInBlobStorage
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

    debug('will backup ' + db.server + '/' + db.name + ' to ' + blob.accountName + '/' + blob.name);

    function processRequest (error, primaryKey) {

        db.user = db.user.match(/@/) ? db.user : db.user + '@' + db.server;
        db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';

        blob.uri = (blob.name.match(/^http/)) ? blob.name :
            'https://' + blob.accountName + '.blob.core.windows.net/' + blob.container + '/' +  blob.name;

        var parameters = {
            connectionInfo: connectionInfoDB(db),
            blobCredentials: {
                storageAccessKey: primaryKey,
                uri: blob.uri
            }
        };

        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        return sqlmgmt.dac.exportMethod(db.server.split('.')[0], parameters, function(error, result) {

            if (error) {
                debug('backup queuing failed: ' + error);
                return callback(error);
            }

            debug(blob.uri + ' successfully queued. Guid=' + result.guid);
            callback(null, result.guid);
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

    debug('will restore ' + blob.accountName + '/' + blob.name + ' to ' + db.server + '/' + db.name);

    assert(blob.name,        'You must provide blob.name');
    assert(blob.accountName, 'You must provide blob.accountName');

    assert(db.name,     'You must provide db.name');
    assert(db.password, 'You must provide db.password');
    assert(db.server,   'You must provide db.server');
    assert(db.user,     'You must provide db.user');

    function processRequest (error, primaryKey) {

        db.user   = db.user.match(/@/) ? db.user : db.user + '@' + db.server;
        db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';

        blob.uri  = (blob.name.match(/^http/)) ? blob.name :
            'https://' + blob.accountName + '.blob.core.windows.net/' + blob.container + '/' +  blob.name;

        var parameters = {
            connectionInfo: connectionInfoDB(db),
            azureEdition: db.edition  || 'Business',
            databaseSizeInGB: db.size || 10,
            blobCredentials: {
                storageAccessKey: primaryKey,
                uri: blob.uri
            }
        };

        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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


function waitUntilRequestFinish (db, guid, callback) {
    function retry () {
        requestStatus (db, guid, function (error, req) {
            // error
            if (error) {
                debug('error: ' + error);
                return callback(error);
            }
            // finished !
            else if (! error && !status) {
                debug('request ' + guid + ' finished');
                return callback(null);
            }

            else {
                debug('still ' + req.status.toLowerCase());
                setTimeout(retry, 10 * 1000);
            }
        });
    }
    retry();
}

function connectionInfoDB (db) {
    return {
        databaseName: db.name,
        password:     db.password,
        serverName:   db.server,
        userName:     db.user
    };
}


function extractGuid (text) {
    return text.match(/<guid.*>(.*)<\/guid>/g)[1];
}


function sortBlobs (a, b) {
    return a.properties['last-modified'] > b.properties['last-modified'] ? 1 : -1;
}


function blobAccountKey (accountName, callback) {

    storagemgmt.storageAccounts.getKeys(accountName, function (err, result) {

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
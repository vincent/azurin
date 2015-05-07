'use strict';

var debug   = require('debug')('azurin');
var fs      = require('fs');
var path    = require('path');
var assert  = require('assert');
var request = require('request');
var azure   = require('azure-storage');
var mgmtSQL = require('azure-mgmt-sql');

var certificate = process.env.AZURE_CERTIFICATE;

var sqlmgmt = mgmtSQL.createSqlManagementClient(mgmtSQL.createCertificateCloudCredentials({
    subscriptionId: path.basename(certificate, '.pem'),
    pem: fs.readFileSync(certificate)
}));

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

    var parameters = {
        connectionInfo: connectionInfoDB(db),
        blobCredentials: {
            storageAccessKey: blob.accountKey,
            uri: blob.uri
        }
    };

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    return sqlmgmt.dac.exportMethod(db.server, parameters, function(error, result) {

        if (error) {
            debug('backup queuing failed: ' + error);
            return callback(error);
        }

        debug(blob.uri + ' successfully queued. Guid=' + result.guid);
        callback(null, result.guid);
    });
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
    assert(blob.accountKey,  'You must provide blob.accountKey');

    assert(db.name,     'You must provide db.name');
    assert(db.password, 'You must provide db.password');
    assert(db.server,   'You must provide db.server');
    assert(db.user,     'You must provide db.user');

    db.user = db.user.match(/@/) ? db.user : db.user + '@' + db.server;

    db.server = db.server.match(/database.windows.net/) ? db.server : db.server + '.database.windows.net';

    blob.uri = (blob.name.match(/^http/)) ? blob.name :
        'https://' + blob.accountName + '.blob.core.windows.net/' + blob.container + '/' +  blob.name;

    var parameters = {
        connectionInfo: connectionInfoDB(db),
        azureEdition: db.edition  || 'Business',
        databaseSizeInGB: db.size || 10,
        blobCredentials: {
            storageAccessKey: blob.accountKey,
            uri: blob.uri
        }
    };

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    return sqlmgmt.dac.importMethod(db.server, parameters, function(error, result) {

        if (error) {
            debug('restore queuing failed: ' + error);
            return callback(error);
        }

        debug(db.name + ' successfully queued. Guid=' + result.guid);
        callback(null, result.guid);
    });
}


function requestStatus (db, guid, callback) {
    return sqlmgmt.dac.getStatus(db.server, db.server + '.database.windows.net', db.user, db.password, guid, callback);
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

function lastImportInBlobStorage (account, key, container, callback) {
    var service = azure.createBlobService(account, key);
    service.listBlobsSegmented(container, null, function(error, result, response){
        if (error || !result.entries) { return callback(error); }
        result.entries.sort(sortBlobs);
        callback(null, result.entries.pop());
    });
}

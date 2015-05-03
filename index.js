'use strict';

var debug   = require('debug')('azurin');
var assert  = require('assert');
var request = require('request');
var azure   = require('azure-storage');

var AZURE_DAC_URL_EXPORT  = 'https://db3prod-dacsvc.azure.com/DACWebService.svc/Export';
var AZURE_DAC_URL_IMPORT  = 'https://db3prod-dacsvc.azure.com/DACWebService.svc/Import';
var AZURE_DAC_URL_SERVICE = 'BlobStorageAccessKeyCredentials:#Microsoft.SqlServer.Management.Dac.ServiceTypes';


module.exports = {
    backup: exportToBlob,
    restore: importFromBlob,
    lastImportInBlobStorage: lastImportInBlobStorage
};

/**
 * Import/Export request
 *
 * @param  {string}   service  service URL
 * @param  {object}   db       { server, name, user, password }
 * @param  {object}   blob     { name, account_name, account_key  }
 * @param  {function} callback callback
 *
 * @return {request}           The underlying request
 */
function azurinRequest (service, db, blob, callback) {

    assert(blob.name,         'You must provide blob.name');
    assert(blob.account_name, 'You must provide blob.account_name');
    assert(blob.account_key,  'You must provide blob.account_key');

    assert(db.name,     'You must provide db.name');
    assert(db.password, 'You must provide db.password');
    assert(db.server,   'You must provide db.server');
    assert(db.user,     'You must provide db.user');

    blob.uri = (blob.name.match(/^http/)) ? blob.name :
        'https://' + blob.account_name + '.blob.core.windows.net/' + blob.container + blob.name;

    var body = {
        ConnectionInfo: connectionInfoDB(db),
        BlobCredentials: {
            Uri: blob.uri,
            __type: AZURE_DAC_URL_SERVICE,
            StorageAccessKey: blob.account_key
        }
    };

    return request.post({
        uri:     service,
        body:    JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }

    }, callback);
}


/**
 * Export database to a blob storage
 *
 * @param  {object}   db       { server, name, user, password }
 * @param  {object}   blob     { name, account_name, account_key  }
 * @param  {function} callback callback
 *
 * @return {request}  The underlying request
 */
function exportToBlob (db, blob, callback) {

    return azurinRequest(AZURE_DAC_URL_EXPORT, db, blob, function(e, r, b) {

        if (e || r.statusCode !== 200) {
            debug('backup queuing failed: ' + (e || r.statusCode));
            callback(e || r.statusCode);
        } else {
            var guid = extractGuid(b);
            debug(blob.uri + ' successfully queued. Guid=' + guid);
            callback(null, guid);
        }
    });
}


/**
 * Import database from a blob storage
 *
 * @param  {object}   db       { server, name, user, password }
 * @param  {object}   blob     { name, account_name, account_key  }
 * @param  {function} callback callback
 *
 * @return {request}  The underlying request
 */
function importFromBlob (db, blob, callback) {

    return azurinRequest(AZURE_DAC_URL_IMPORT, db, blob, function(e, r, b) {

        if (e || r.statusCode !== 200) {
            debug('restore queuing failed: ' + (e || r.statusCode));
            callback(e || r.statusCode);
        } else {
            var guid = extractGuid(b);
            debug(db.name + ' successfully queued. Guid=' + guid);
            callback(null, guid);
        }
    });
}


function connectionInfoDB (db) {
    return {
        DatabaseName: db.name,
        Password:     db.password,
        ServerName:   db.server,
        UserName:     db.user
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
#!/usr/bin/env node
'use strict';

var program = require('commander');
var moment  = require('moment');
var assert  = require('assert');
var packg   = require(__dirname + '/package.json');
var debug   = require('debug');

var azurin  = require('./index');

program
  .version(packg.version)
  .usage('<backup/restore> [options]')
  .option('-u, --db-user <server>',       'Database user')
  .option('-p, --db-password <password>', 'Database password')
  .option('-s, --db-server <server>',     'Database server')
  .option('-d, --db-name <name>',         'Database name')
  .option('-a, --blob-account <account>', 'Blob storage account name')
  .option('-k, --blob-account-key <key>', 'Blob storage account key')
  .option('-b, --blob-name <cont/name>',  'Blob name, defaults to DB/YYYY-MM-DD-HH-mm.bacpac')
  .option('-c, --blob-container <cont>',  'Blob container, defaults to database name')
  .option('-v, --verbose', 'Verbose')
  .parse(process.argv);

program.on('--help', function(){
  console.log('  Example:');
  console.log('');
  console.log('    $ command backup -u user -p password -s server -d dbname -a storage -k 12345');
  console.log('    $ command restore --db-user user --db-password password --db-server server --db-name dbname --blob-account storage --blob-account-key 12345');
  console.log('');
});

if (program.verbose) {
    debug.enable('azurin');
}

var op = program.args[0];

if (op !== 'backup' && op !== 'restore' ||
    ! (program.dbUser && program.dbPassword && program.dbServer && program.dbName) ||
    ! (program.blobAccount && program.blobAccountKey)) {
    program.help();
}

var db = {
    user: program.dbUser,
    password: program.dbPassword,
    name: program.dbName,
    server: program.dbServer
};

var blob = {
    name: program.blobName,
    container: program.blobContainer || db.name,
    accountName: program.blobAccount,
    accountKey: program.blobAccountKey
};

function guessBlobName (op, callback) {

    if (! blob.name) {
        if (op === 'backup') {
            blob.name = blob.container + '/' + db.name + '-' + moment().format('YYYY-MM-DD-HH-mm') + '.bacpac';
            return callback(null, blob.name);

        } else if (op === 'restore') {
            return azurin.lastImportInBlobStorage(blob.accountName, blob.accountKey, blob.container, function (error, lastBlob) {
                blob.name = blob.container + '/' + lastBlob.name;
                callback(error, blob.name);
            });
        }
    }

    return callback(null, blob.name);
}

guessBlobName(op, function(error, name) {

    console.log(op, 'from', db, 'to', blob);

    process.exit();
    azurin[op](db, blob, function(error){
        process.exit(error ? 1 : 0);
    });
});


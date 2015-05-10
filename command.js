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
  .usage('<backup/restore/rstatus> [options]')
  .option('--db-user <server>',       'Database user')
  .option('--db-password <password>', 'Database password')
  .option('--db-server <server>',     'Database server')
  .option('--db-name <name>',         'Database name')
  .option('--blob-account <account>', 'Blob storage account name, defaults to AZURE_STORAGE_ACCOUNT')
  .option('--blob-account-key <key>', 'Blob storage account key, optional, defaults to AZURE_STORAGE_ACCESS_KEY')
  .option('--blob-name <cont/name>',  'Blob name, defaults to DB/YYYY-MM-DD-HH-mm.bacpac')
  .option('--blob-container <cont>',  'Blob container, defaults to database name')
  .option('--request-id',             'Request GUID')
  .option('--wait',                   'Wait for the request to finish')
  .option('--verbose',                'Verbose')
  .parse(process.argv);

program.on('--help', function(){
  console.log('  Example:');
  console.log('');
  console.log('    $ command backup  --db-user user --db-password password --db-server server --db-name dbname --blob-account storage');
  console.log('    $ command restore --db-user user --db-password password --db-server server --db-name dbname --blob-account storage');
  console.log('    $ command rstatus --db-user user --db-password password --db-server server --db-name dbname --request-id 1234-5678-91011');
  console.log('');
});

program.blobAccount    = program.blobAccount    || process.env.AZURE_STORAGE_ACCOUNT;
program.blobAccountKey = program.blobAccountKey || process.env.AZURE_STORAGE_ACCESS_KEY;

if (program.verbose) {
    debug.enable('azurin');
}

var op = program.args[0];

if (op !== 'rstatus' && op !== 'backup' && op !== 'restore' ||
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
      blob.name = db.name + '-' + moment().format('YYYY-MM-DD-HH-mm') + '.bacpac';
      return callback(null, blob.name);

    } else if (op === 'restore') {
      return azurin.lastImportInBlobStorage(blob.accountName, blob.accountKey, blob.container, function (error, lastBlob) {
        blob.name = lastBlob.name;
        callback(error, blob.name);
      });
    }
  }

  return callback(null, blob.name);
}

if (op === 'rstatus') {
  azurin.requestStatus(db, program.requestId, function(error, result){
    console.log(result.statusInfoList);
    process.exit(error ? 1 : 0);
  });

} else {
  guessBlobName(op, function(error, name) {
    azurin[op](db, blob, function(error, guid){
      if (error) return process.exit(1);
      if (!error && !guid) return process.exit(0);

      if (program.wait) {
        azurin.waitUntilRequestFinish(db, guid, function (error) {
          process.exit(error ? 1 : 0);
        });
      } else {
        process.exit();
      }

    });
  });
}


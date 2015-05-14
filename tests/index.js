/* jshint undef: true, unused: true */
/* global describe, it, before, after */
'use strict';

var Azurin = require('../index');

/* jshint newcap: false */
var azurin = Azurin(process.env.AZURE_CERTIFICATE);
/* jshint newcap: true */

var path   = require('path');
var moment = require('moment');
var assert = require('assert');

var backupRequestGuid, backupRequestFinished, restoreRequestGuid;

var db = {
  user: process.env.AZURIN_TEST_DBUSER,
  password: process.env.AZURIN_TEST_DBPASSWORD,
  name: process.env.AZURIN_TEST_DBNAME,
  server: process.env.AZURIN_TEST_DBSERVER
};

var blob = {
  container: db.name,
  accountName: process.env.AZURIN_TEST_BLOBACCOUNT
};


function gotBackupRequest (done) {
  if (backupRequestGuid) {
    done();
  } else {
    setTimeout( function(){ gotBackupRequest(done); }, 1000);
  }
}

function backupRequestIsFinished (done) {
  if (backupRequestFinished) {
    done();
  } else {
    setTimeout( function(){ backupRequestIsFinished(done); }, 1000);
  }
}

function gotRestoreRequest (done) {
  if (restoreRequestGuid) {
    done();
  } else {
    setTimeout( function(){ gotRestoreRequest(done); }, 1000);
  }
}

describe('#backup()', function(){

  this.timeout(10000);

  it('should return a backup request GUID', function(done){
    blob.name = db.name + '-' + moment().format('YYYY-MM-DD-HH-mm') + '.bacpac';
    azurin.backup(db, blob, function(error, guid){
      backupRequestGuid = guid;
      assert(guid);
      done();
    });
  });

});


describe('when we got backup request GUID', function(){

  this.timeout(20000);

  before(function(done) {
    gotBackupRequest(done);
  });

  describe('#waitUntilRequestFinish() (backup)', function(){
    it('should wait until the backup request finish', function(done){
      azurin.waitUntilRequestFinish(db, backupRequestGuid, function (error) {
        assert(! error);
        backupRequestFinished = true;
        blob.hasBeenCopied = true;
        done();
      });
    });
  });

});

////////////////


describe('when we got backup request finished', function(){

  this.timeout(300000);

  before(function(done) {
    backupRequestIsFinished(done);
  });

  describe('#restore()', function(){
    it('should return a restore request GUID', function(done){
      db.name = path.basename(blob.name, '.bacpac');
      azurin.restore(db, blob, function(error, guid){
        restoreRequestGuid = guid;
        assert(guid);
        done();
      });
    });
  });
});

describe('when we got restore request GUID', function(){

  this.timeout(300000);

  before(function(done) {
    gotRestoreRequest(done);
  });

  after(function(done){
    if (blob.hasBeenCopied) {
      azurin.deleteContainer(blob, function () {
        if (db.hasBeenRestored) {
          azurin.deleteDatabase(db, function () {
            done();
          });
        }
      });
    } else if (db.hasBeenRestored) {
      azurin.deleteDatabase(db, function () {
        done();
      });
    }
  });

  describe('#waitUntilRequestFinish() (restore)', function(){
    it('should wait until the restore request finish', function(done){
      azurin.waitUntilRequestFinish(db, restoreRequestGuid, function(error){
        assert(! error);
        db.hasBeenRestored = true;
        done();
      });
    });
  });

});

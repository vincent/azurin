/* jshint undef: true, unused: true */
/* global describe, it */
'use strict';

var Azurin = require('../index');

/* jshint newcap: false */
var azurin = Azurin(process.env.AZURE_CERTIFICATE);
/* jshint newcap: true */

var assert = require('assert');

var blob = {
  container: process.env.AZURIN_TEST_STORAGE_CONTAINER,
  name: process.env.AZURIN_TEST_BLOBACCOUNT
};

describe('#lastImportInBlobStorage()', function(){

  this.timeout(10000);

  it('should return the last blob in container', function(done){
    azurin.blobAccountKey(blob.name, function (error, key) {
      azurin.lastImportInBlobStorage (blob.name, key, blob.container,
        function (error, last) {
          assert(last);
          done();
        });
    });
  });
});

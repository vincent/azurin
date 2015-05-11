# azurin

[![Build Status](http://ci.three-arena.com/buildStatus/icon?job=azurin)](http://ci.three-arena.com/job/azurin/)

Backup and restore an Azure SQL database.

- automatically uses blob/dbname/dbname-YYYY-MM-DD-HH-mm.bacpac
- automatically restores the latest blob to dbname-YYYY-MM-DD-HH-mm
- does not store passwords or access_key, use an azure certificate
- check a import/export request status, or wait for the request to finish

# install

```
npm install -g azurin
```

# usage

Backup an Azure SQL database to a blob stored bacpac, as [Start-AzureSqlDatabaseImport](https://msdn.microsoft.com/en-us/library/dn546725.aspx)

Restore a bacpac as a new Azure SQL database, as [Start-AzureSqlDatabaseExport](https://msdn.microsoft.com/en-us/library/dn546720.aspx)

```
azurin <backup/restore> [options]

Options:

  --help                     Output usage information
  --certificate <file>       Azure certificate, defaults to AZURE_CERTIFICATE
  --db-user <server>         Database user
  --db-password <password>   Database password
  --db-server <server>       Database server
  --db-name <name>           Database name
  --blob-account <account>   Blob storage account name, defaults to AZURE_STORAGE_ACCOUNT
  --blob-account-key <key>   Optional blob storage account key
  --blob-name <cont/name>    Blob name, defaults to DB/YYYY-MM-DD-HH-mm.bacpac for backups, and latest blob in container for restore
  --blob-container <cont>    Blob container, defaults to database name
  --request-id               Request GUID
  --wait                     Wait for the request to finish
  --verbose                  Verbose

Example:

  $ command backup -u user -p password -s server -d dbname -a storage -k 12345
  $ command restore --db-user user --db-password password --db-server server --db-name dbname --blob-account storage --blob-account-key 12345
```

```
azurin <status> [options]

Options:

  --help                     Output usage information
  --certificate <file>       Azure certificate, defaults to AZURE_CERTIFICATE
  --db-user <server>         Database user
  --db-password <password>   Database password
  --db-server <server>       Database server
  --db-name <name>           Database name
  --request-id               Request GUID
  --wait                     Wait for the request to finish
  --verbose                  Verbose

Example:

  $ command status --db-user user --db-password password --db-server server --db-name dbname --request-id 1234-5678-91011
```

# tests

A test suite is available as `npm test` and uses Mocha. It backups, restore, and delete a database.
This test assumes all AZURE_CERTIFICATE, AZURE_STORAGE_ACCOUNT, AZURIN_TEST_BLOBACCOUNT, AZURIN_TEST_DBUSER, AZURIN_TEST_DBPASSWORD, AZURIN_TEST_DBNAME and AZURIN_TEST_DBSERVER environment variables are set.

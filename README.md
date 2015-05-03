# azurin

- Backup an Azure SQL database to a blob
- Restore a backup in an Azure SQL database

```
azurin <backup/restore> [options]

Options:

  -h, --help                    output usage information
  -V, --version                 output the version number
  -u, --db-user <server>        Database user
  -p, --db-password <password>  Database password
  -s, --db-server <server>      Database server
  -d, --db-name <name>          Database name
  -a, --blob-account <account>  Blob storage account name
  -k, --blob-account-key <key>  Blob storage account key
  -b, --blob-name <cont/name>   Blob name, defaults to DB/YYYY-MM-DD-HH-mm.bacpac
  -c, --blob-container <cont>   Blob container, defaults to database name
  -v, --verbose                 Verbose

Example:

  $ command backup -u user -p password -s server -d dbname -a storage -k 12345
  $ command restore --db-user user --db-password password --db-server server --db-name dbname --blob-account storage --blob-account-key 12345
```

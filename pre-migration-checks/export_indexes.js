// =============================================================================
// Script      : export_indexes.js
// Description : Exports all non-default indexes across every user database on
//               a MongoDB instance as ready-to-run createIndex() commands.
//               Skips system databases (local, admin, config) and the built-in
//               _id_ index. Preserves unique and TTL (expireAfterSeconds)
//               options. Output can be replayed on a target instance to
//               recreate the index structure — useful for migrations, cluster
//               cloning, or index documentation.
// =============================================================================

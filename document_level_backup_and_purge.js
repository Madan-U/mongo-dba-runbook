// =============================================================================
// Script      : document_level_backup_and_purge.js
// Description : Performs a safe document-level backup of a targeted set of
//               documents from a source collection into an archive collection
//               before permanently deleting them. Follows a
//               count-verify → archive → re-verify → delete pattern to ensure
//               no data is lost. Intended as a pre-change safety procedure
//               before any bulk delete or data migration operation.
//
// Usage       : mongosh --quiet --file document_level_backup_and_purge.js
//
// Prerequisites:
//   - Connected to the correct database and cluster before running.
//   - Archive collection must exist or will be created automatically on insert.
//   - User must have read + write privileges on both source and archive
//     collections.
//
// Author      : Madan U
// Email       : madanu135@gmail.com
//
// Notes       :
//   - $merge with whenMatched: "keepExisting" ensures existing archived
//     documents are never overwritten — safe to re-run.
//   - deleteMany is only executed after archive count is verified.
//   - Update TARGET_IDS, SOURCE_COLLECTION, and ARCHIVE_COLLECTION
//     before running.
// =============================================================================

// -----------------------------------------------------------------------------
// Configuration — update these values before running
// -----------------------------------------------------------------------------
var TARGET_IDS         = ["<id-1>", "<id-2>"];   // Filter values (e.g. userIds)
var FILTER_FIELD       = "<filter-field>";         // Field to filter on (e.g. "userId")
var SOURCE_COLLECTION  = "<source-collection>";    // Collection to back up and purge from
var ARCHIVE_COLLECTION = "<archive-collection>";   // Destination archive collection

// -----------------------------------------------------------------------------
// Build reusable filter
// -----------------------------------------------------------------------------
var matchFilter = {};
matchFilter[FILTER_FIELD] = { $in: TARGET_IDS };

// =============================================================================
// Phase 1 — Pre-Archive Count Verification
// =============================================================================
print("\n" + "=".repeat(60));
print("Phase 1 : Pre-Archive Count Verification");
print("=".repeat(60));

var sourceCountBefore  = db.getCollection(SOURCE_COLLECTION).countDocuments(matchFilter);
var archiveCountBefore = db.getCollection(ARCHIVE_COLLECTION).countDocuments(matchFilter);

print("Source collection  (" + SOURCE_COLLECTION  + ") — documents matched : " + sourceCountBefore);
print("Archive collection (" + ARCHIVE_COLLECTION + ") — documents matched : " + archiveCountBefore);

if (sourceCountBefore === 0) {
    print("\n[WARN] No matching documents found in source collection. Exiting without changes.");
    quit();
}

// =============================================================================
// Phase 2 — Archive Documents to Archive Collection
// =============================================================================
print("\n" + "=".repeat(60));
print("Phase 2 : Archiving Documents");
print("=".repeat(60));

db.getCollection(SOURCE_COLLECTION).aggregate([
    {
        $match: matchFilter
    },
    {
        $merge: {
            into: ARCHIVE_COLLECTION,
            on: "_id",
            whenMatched:    "keepExisting",   // Never overwrite existing archive records
            whenNotMatched: "insert"
        }
    }
]);

print("Archive operation completed.");

// =============================================================================
// Phase 3 — Post-Archive Count Verification
// =============================================================================
print("\n" + "=".repeat(60));
print("Phase 3 : Post-Archive Count Verification");
print("=".repeat(60));

var archiveCountAfter = db.getCollection(ARCHIVE_COLLECTION).countDocuments(matchFilter);

print("Archive collection (" + ARCHIVE_COLLECTION + ") — documents matched : " + archiveCountAfter);

if (archiveCountAfter < sourceCountBefore) {
    print("\n[ERROR] Archive count (" + archiveCountAfter + ") is less than source count (" +
          sourceCountBefore + "). Aborting delete — investigate before proceeding.");
    quit();
}

print("[OK] Archive verified. Proceeding with delete.");

// =============================================================================
// Phase 4 — Delete Documents from Source Collection
// =============================================================================
print("\n" + "=".repeat(60));
print("Phase 4 : Deleting Documents from Source Collection");
print("=".repeat(60));

var deleteResult = db.getCollection(SOURCE_COLLECTION).deleteMany(matchFilter);

print("Documents deleted from source : " + deleteResult.deletedCount);

// =============================================================================
// Phase 5 — Final Verification
// =============================================================================
print("\n" + "=".repeat(60));
print("Phase 5 : Final Verification");
print("=".repeat(60));

var sourceCountAfter = db.getCollection(SOURCE_COLLECTION).countDocuments(matchFilter);

print("Source collection  (" + SOURCE_COLLECTION  + ") — documents remaining : " + sourceCountAfter);
print("Archive collection (" + ARCHIVE_COLLECTION + ") — documents archived  : " + archiveCountAfter);

if (sourceCountAfter === 0) {
    print("\n[SUCCESS] All targeted documents archived and removed from source.");
} else {
    print("\n[WARN] " + sourceCountAfter + " document(s) still remain in source. Review and re-run if required.");
}

print("\n" + "=".repeat(60));
print("Operation Complete");
print("=".repeat(60));

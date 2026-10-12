// =============================================================================
// Script      : check_duplicateUUIDs.js
// Description : Scans a all MongoDB collection for duplicateUUIDs.
// Author      : Madan U
// Email       : madanu135@gmail.com
// Platform    : MongoFleet — MongoDB DBA Platform
// =============================================================================

function checkDuplicateUUIDs() {  
  let uuidMap = {};  
  
  // Get all non-system databases (safer for DocumentDB)  
  let dbNames = db.getMongo().getDBNames();  
  dbNames.forEach(function(dbName) {  
    if (["admin", "config", "local"].indexOf(dbName) !== -1) return; // skip system DBs  
    let dbRef = db.getSiblingDB(dbName);  
  
    let collList;  
    try {  
      collList = dbRef.runCommand({ listCollections: 1.0 }).cursor.firstBatch;  
    } catch (e) {  
      print(`Error listing collections for ${dbName}: ${e}`);  
      return;  
    }  
  
    collList.forEach(function(collItem) {  
      let collName = collItem.name;  
      let uuid = collItem.info && collItem.info.uuid;  
      if (!uuid) return;  
  
      if (uuidMap[uuid]) {  
        print(`Duplicate UUID: ${uuid}`);  
        print(`Collections: ${uuidMap[uuid]} and ${dbName}.${collName}`);  
      } else {  
        uuidMap[uuid] = `${dbName}.${collName}`;  
      }  
    });  
  });  
}  
  
checkDuplicateUUIDs();  

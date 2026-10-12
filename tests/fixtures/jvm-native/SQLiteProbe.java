import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteException;

public class SQLiteProbe {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void rejects(Runnable work, String message) { try { work.run(); throw new AssertionError(message); } catch (SQLiteException expected) { } }
    private static class Cache extends SQLiteOpenHelper {
        Cache(int version) { super(new Context(), "probe.db", null, version); }
        public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER, blob BLOB)"); }
        public void onUpgrade(SQLiteDatabase db, int from, int to) { db.execSQL("ALTER TABLE cache ADD COLUMN upgraded INTEGER DEFAULT 1"); }
    }
    public static void main(String[] args) throws Exception {
        System.setProperty("tvbox.spiderCacheDir", args[0]);
        Cache helper = new Cache(1);
        SQLiteDatabase db = helper.getWritableDatabase();
        check(db.getVersion() == 1 && db.isOpen(), "schema creation");
        String dbPath = db.getPath();
        SQLiteDatabase readonly = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
        check(readonly.isReadOnly(), "read-only flag");
        rejects(() -> readonly.execSQL("CREATE TABLE forbidden(x)"), "read-only writes rejected");
        readonly.close();
        java.io.File missing = new java.io.File(new java.io.File(dbPath).getParentFile(), "missing.db");
        rejects(() -> SQLiteDatabase.openDatabase(missing.getPath(), null, SQLiteDatabase.OPEN_READWRITE), "no implicit create");
        check(!missing.exists(), "missing database not created");
        rejects(() -> SQLiteDatabase.openDatabase(dbPath, null, 0x20000000), "unknown flags rejected");
        ContentValues value = new ContentValues();
        value.put("key", "quoted'key"); value.put("value", "good"); value.put("expires_at", 100L); value.put("blob", new byte[]{1,2});
        check(db.replace("cache", null, value) > 0, "insert");
        value.put("value", "updated"); check(db.replace("cache", null, value) > 0, "replace");
        Cursor c = db.query("cache", new String[]{"value", "expires_at", "blob"}, "key=?", new String[]{"quoted'key"}, null, null, null);
        check(c.getCount() == 1 && c.moveToFirst() && c.getString(c.getColumnIndexOrThrow("value")).equals("updated"), "query bound key");
        check(c.getLong(1) == 100 && c.getBlob(2).length == 2 && c.getType(2) == 4, "types"); c.close(); check(c.isClosed(), "cursor close");
        db.beginTransaction(); db.delete("cache", null, null); db.endTransaction();
        c = db.rawQuery("SELECT COUNT(*) FROM cache", null); c.moveToFirst(); check(c.getInt(0) == 1, "rollback"); c.close();
        helper.close();
        try { new Cache(0); throw new AssertionError("invalid schema version rejected"); } catch (IllegalArgumentException expected) { }
        Cache upgraded = new Cache(2); db = upgraded.getWritableDatabase();
        check(db.getVersion() == 2, "schema upgrade");
        rejects(() -> new Cache(1).getWritableDatabase(), "default downgrade rejected");
        check(db.getVersion() == 2, "failed downgrade preserves version");
        c = db.rawQuery("SELECT value, upgraded FROM cache WHERE key=?", new String[]{"quoted'key"});
        check(c.moveToFirst() && c.getString(0).equals("updated") && c.getInt(1) == 1, "persistence"); c.close();
        db.beginTransaction(); check(db.delete("cache", "expires_at<?", new String[]{"101"}) == 1, "expiry delete"); db.setTransactionSuccessful(); db.endTransaction();
        c = db.rawQuery("SELECT * FROM cache", null); check(c.getCount() == 0 && !c.moveToFirst(), "committed delete"); c.close();
        final SQLiteDatabase shared = db;
        shared.beginTransaction(); shared.execSQL("INSERT INTO cache(key,value) VALUES('owner','kept')");
        Throwable[] backgroundFailure = {null};
        Thread other = new Thread(() -> {
            try {
                check(!shared.inTransaction(), "transaction belongs to calling thread");
                rejects(() -> shared.execSQL("INSERT INTO cache(key) VALUES('other')"), "other thread must not join transaction");
                rejects(() -> shared.rawQuery("SELECT * FROM cache", null), "other thread must not observe uncommitted rows");
                rejects(shared::setTransactionSuccessful, "other thread cannot mark success");
                rejects(shared::endTransaction, "other thread cannot end transaction");
            } catch (Throwable error) { backgroundFailure[0] = error; }
        });
        other.start(); other.join(10000); check(!other.isAlive() && backgroundFailure[0] == null, "cross-thread checks");
        shared.endTransaction();
        c = shared.rawQuery("SELECT * FROM cache", null); check(c.getCount() == 0, "owner rollback unaffected"); c.close();
        Thread independent = new Thread(() -> {
            try { shared.execSQL("INSERT INTO cache(key) VALUES('after')"); }
            catch (Throwable error) { backgroundFailure[0] = error; }
        });
        independent.start(); independent.join(10000); check(!independent.isAlive() && backgroundFailure[0] == null, "cross-thread access after transaction");
        upgraded.close();
        System.out.println("sqlite-cache-ok");
    }
}

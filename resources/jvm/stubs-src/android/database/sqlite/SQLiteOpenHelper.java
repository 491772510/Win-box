package android.database.sqlite;

import android.content.Context;
import android.database.DatabaseErrorHandler;

/**
 * SQLiteOpenHelper: lazy database opening and transactional schema creation/upgrades.
 */
public abstract class SQLiteOpenHelper {

    private final Context context;
    private final String name;
    private final int version;
    private SQLiteDatabase database = null;

    public SQLiteOpenHelper(Context context, String name, SQLiteDatabase.CursorFactory factory, int version) {
        if (version < 1) throw new IllegalArgumentException("Version must be >= 1");
        if (factory != null) throw new SQLiteException("Custom Android CursorFactory is not supported");
        this.context = context;
        this.name = name == null ? ":memory:" : name;
        this.version = version;
    }

    public SQLiteOpenHelper(Context context, String name, SQLiteDatabase.CursorFactory factory, int version,
                            DatabaseErrorHandler errorHandler) {
        this(context, name, factory, version);
    }

    public String getDatabaseName() {
        return name;
    }

    public synchronized SQLiteDatabase getWritableDatabase() {
        if (database == null || !database.isOpen()) {
            java.io.File path = name.equals(":memory:") ? null : context.getDatabasePath(name);
            SQLiteDatabase db = path == null ? SQLiteDatabase.create(null) : SQLiteDatabase.openOrCreateDatabase(path, null);
            try {
                onConfigure(db);
                int old = db.getVersion();
                if (old != version) {
                    db.beginTransaction();
                    try {
                        if (old == 0) onCreate(db);
                        else if (old < version) onUpgrade(db, old, version);
                        else onDowngrade(db, old, version);
                        db.setVersion(version); db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                }
                onOpen(db); database = db;
            } catch (RuntimeException error) { db.close(); throw error; }
        }
        return database;
    }

    public synchronized SQLiteDatabase getReadableDatabase() {
        return getWritableDatabase();
    }

    public synchronized void close() {
        if (database != null) {
            database.close();
            database = null;
        }
    }

    public void onConfigure(SQLiteDatabase db) {
    }

    public abstract void onCreate(SQLiteDatabase db);

    public abstract void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion);

    public void onDowngrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new SQLiteException("Cannot downgrade database from " + oldVersion + " to " + newVersion);
    }

    public void onOpen(SQLiteDatabase db) {
    }

    public synchronized void setWriteAheadLoggingEnabled(boolean enabled) {
    }
}

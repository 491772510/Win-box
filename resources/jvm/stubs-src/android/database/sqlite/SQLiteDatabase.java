package android.database.sqlite;

import android.database.Cursor;
import android.database.DatabaseErrorHandler;
import java.sql.*;
import java.util.*;

/**
 * Desktop SQLite adapter (sqlite-jdbc). Query results are detached in-memory cursors;
 * writes and transactions use a real SQLite file rather than pretending caches are empty.
 */
public class SQLiteDatabase extends SQLiteClosable {

    private final String path;
    private boolean open = true;
    private Connection connection;
    private boolean transactionSuccessful;
    private Thread transactionOwner;
    private final boolean readOnly;
    public static final int OPEN_READWRITE = 0, OPEN_READONLY = 1, CREATE_IF_NECESSARY = 0x10000000;

    private SQLiteDatabase(String path) {
        this(path, CREATE_IF_NECESSARY);
    }

    private SQLiteDatabase(String path, int flags) {
        if ((flags & ~(OPEN_READONLY | CREATE_IF_NECESSARY)) != 0) throw new SQLiteException("Unsupported SQLite open flags: " + flags);
        readOnly = (flags & OPEN_READONLY) != 0;
        this.path = path == null ? ":memory:" : path;
        try {
            Class.forName("org.sqlite.JDBC");
            if (!this.path.equals(":memory:") && !readOnly && (flags & CREATE_IF_NECESSARY) != 0) {
                java.io.File parent = new java.io.File(this.path).getAbsoluteFile().getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) throw new java.io.IOException("Cannot create database directory");
            }
            Properties properties = new Properties();
            properties.setProperty("open_mode", String.valueOf(readOnly ? 1 : 2 | ((flags & CREATE_IF_NECESSARY) != 0 ? 4 : 0)));
            connection = DriverManager.getConnection("jdbc:sqlite:" + this.path, properties);
            try (Statement statement = connection.createStatement()) { statement.execute("PRAGMA busy_timeout=10000"); }
        } catch (Exception e) { throw failure(e); }
    }

    // ---------------- 打开 / 关闭 ----------------

    public static SQLiteDatabase openDatabase(String path, CursorFactory factory, int flags) {
        requireDefaultFactory(factory);
        return new SQLiteDatabase(path, flags);
    }

    public static SQLiteDatabase openDatabase(String path, CursorFactory factory, int flags, DatabaseErrorHandler errorHandler) {
        return openDatabase(path, factory, flags);
    }

    public static SQLiteDatabase openOrCreateDatabase(String path, CursorFactory factory) {
        requireDefaultFactory(factory);
        return new SQLiteDatabase(path);
    }

    public static SQLiteDatabase openOrCreateDatabase(java.io.File file, CursorFactory factory) {
        requireDefaultFactory(factory);
        return new SQLiteDatabase(file == null ? null : file.getAbsolutePath());
    }

    public static SQLiteDatabase openOrCreateDatabase(String path, CursorFactory factory, DatabaseErrorHandler errorHandler) {
        return openOrCreateDatabase(path, factory);
    }

    public static SQLiteDatabase create(CursorFactory factory) {
        requireDefaultFactory(factory);
        return new SQLiteDatabase(":memory:");
    }

    public boolean isOpen() { return open; }

    public boolean isReadOnly() { return readOnly; }

    public String getPath() { return path; }

    @Override
    public synchronized void close() {
        if (!open) return;
        requireAccess();
        try { connection.close(); } catch (SQLException e) { throw failure(e); }
        open = false;
        super.close();
    }

    // ---------------- 查询（真实结果，游标与 JDBC 资源脱离） ----------------

    public Cursor rawQuery(String sql, String[] selectionArgs) {
        return select(sql, selectionArgs);
    }

    public Cursor rawQuery(String sql, String[] selectionArgs, android.os.CancellationSignal cancellationSignal) {
        return rawQuery(sql, selectionArgs);
    }

    public Cursor query(String table, String[] columns, String selection, String[] selectionArgs,
                        String groupBy, String having, String orderBy) {
        return query(false, table, columns, selection, selectionArgs, groupBy, having, orderBy, null);
    }

    public Cursor query(String table, String[] columns, String selection, String[] selectionArgs,
                        String groupBy, String having, String orderBy, String limit) {
        return query(false, table, columns, selection, selectionArgs, groupBy, having, orderBy, limit);
    }

    public Cursor query(boolean distinct, String table, String[] columns, String selection, String[] selectionArgs,
                        String groupBy, String having, String orderBy, String limit) {
        String projection = columns == null || columns.length == 0 ? "*" : String.join(",", columns);
        String sql = "SELECT " + (distinct ? "DISTINCT " : "") + projection + " FROM " + identifier(table);
        if (selection != null && !selection.isEmpty()) sql += " WHERE " + selection;
        if (groupBy != null && !groupBy.isEmpty()) sql += " GROUP BY " + groupBy;
        if (having != null && !having.isEmpty()) sql += " HAVING " + having;
        if (orderBy != null && !orderBy.isEmpty()) sql += " ORDER BY " + orderBy;
        if (limit != null && !limit.isEmpty()) sql += " LIMIT " + limit;
        return select(sql, selectionArgs);
    }

    public Cursor query(boolean distinct, String table, String[] columns, String selection, String[] selectionArgs,
                        String groupBy, String having, String orderBy, String limit,
                        android.os.CancellationSignal cancellationSignal) {
        return query(distinct, table, columns, selection, selectionArgs, groupBy, having, orderBy, limit);
    }

    public Cursor queryWithFactory(CursorFactory cursorFactory, boolean distinct, String table, String[] columns,
                                   String selection, String[] selectionArgs, String groupBy, String having,
                                   String orderBy, String limit) {
        requireDefaultFactory(cursorFactory);
        return query(distinct, table, columns, selection, selectionArgs, groupBy, having, orderBy, limit);
    }

    // ---------------- 执行 ----------------

    /**
     * Real writes: propagate failures instead of reporting success with lost data.
     */
    public void execSQL(String sql) {
        execSQL(sql, null);
    }

    public void execSQL(String sql, Object[] bindArgs) {
        execute(sql, bindArgs);
    }

    public SQLiteStatement compileStatement(String sql) {
        throw new SQLiteException("桌面 SQLite 暂不支持 Android SQLiteStatement 编译接口：" + sql);
    }

    public int delete(String table, String whereClause, String[] whereArgs) {
        return execute("DELETE FROM " + identifier(table) + (whereClause == null || whereClause.isEmpty() ? "" : " WHERE " + whereClause), whereArgs);
    }

    public long insert(String table, String nullColumnHack, android.content.ContentValues values) {
        try { return insertOrThrow(table, nullColumnHack, values); }
        catch (SQLiteException e) { return -1; }
    }

    public long insertOrThrow(String table, String nullColumnHack, android.content.ContentValues values) {
        return insertWithOnConflict(table, nullColumnHack, values, CONFLICT_NONE);
    }

    public int update(String table, android.content.ContentValues values, String whereClause, String[] whereArgs) {
        List<Object> args = new ArrayList<>();
        List<String> assignments = new ArrayList<>();
        for (Map.Entry<String, Object> entry : values.valueSet()) {
            assignments.add(identifier(entry.getKey()) + "=?"); args.add(entry.getValue());
        }
        if (whereArgs != null) Collections.addAll(args, whereArgs);
        return execute("UPDATE " + identifier(table) + " SET " + String.join(",", assignments)
                + (whereClause == null || whereClause.isEmpty() ? "" : " WHERE " + whereClause), args.toArray());
    }

    public static final int CONFLICT_NONE = 0, CONFLICT_ROLLBACK = 1, CONFLICT_ABORT = 2,
            CONFLICT_FAIL = 3, CONFLICT_IGNORE = 4, CONFLICT_REPLACE = 5;

    public long replace(String table, String nullColumnHack, android.content.ContentValues values) {
        try { return replaceOrThrow(table, nullColumnHack, values); } catch (SQLiteException e) { return -1; }
    }
    public long replaceOrThrow(String table, String nullColumnHack, android.content.ContentValues values) {
        return insertWithOnConflict(table, nullColumnHack, values, CONFLICT_REPLACE);
    }
    public synchronized long insertWithOnConflict(String table, String nullColumnHack, android.content.ContentValues values, int conflict) {
        String[] modes = {"", " OR ROLLBACK", " OR ABORT", " OR FAIL", " OR IGNORE", " OR REPLACE"};
        if (conflict < 0 || conflict >= modes.length) throw new IllegalArgumentException("Invalid conflict mode");
        List<String> columns = new ArrayList<>(), slots = new ArrayList<>(); List<Object> args = new ArrayList<>();
        if (values != null) for (Map.Entry<String, Object> entry : values.valueSet()) {
            columns.add(identifier(entry.getKey())); slots.add("?"); args.add(entry.getValue());
        }
        if (columns.isEmpty() && nullColumnHack != null) { columns.add(identifier(nullColumnHack)); slots.add("NULL"); }
        String suffix = columns.isEmpty() ? " DEFAULT VALUES" : " (" + String.join(",", columns) + ") VALUES (" + String.join(",", slots) + ")";
        if (execute("INSERT" + modes[conflict] + " INTO " + identifier(table) + suffix, args.toArray()) == 0) return -1;
        Cursor cursor = select("SELECT last_insert_rowid()", null);
        try { cursor.moveToFirst(); return cursor.getLong(0); } finally { cursor.close(); }
    }

    private static String identifier(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }
    private static SQLiteException failure(Exception cause) {
        SQLiteException error = new SQLiteException("SQLite: " + cause.getMessage()); error.initCause(cause); return error;
    }
    private PreparedStatement prepare(String sql, Object[] args) throws SQLException {
        requireAccess();
        PreparedStatement statement = connection.prepareStatement(sql);
        try {
            if (args != null) for (int i = 0; i < args.length; i++) statement.setObject(i + 1, args[i]);
            return statement;
        } catch (SQLException e) { statement.close(); throw e; }
    }
    private synchronized int execute(String sql, Object[] args) {
        try (PreparedStatement statement = prepare(sql, args)) {
            statement.execute(); return Math.max(0, statement.getUpdateCount());
        } catch (SQLException e) { throw failure(e); }
    }
    private synchronized Cursor select(String sql, Object[] args) {
        try (PreparedStatement statement = prepare(sql, args); ResultSet result = statement.executeQuery()) {
            ResultSetMetaData meta = result.getMetaData(); String[] columns = new String[meta.getColumnCount()];
            for (int i = 0; i < columns.length; i++) columns[i] = meta.getColumnLabel(i + 1);
            List<Object[]> rows = new ArrayList<>();
            while (result.next()) { Object[] row = new Object[columns.length]; for (int i = 0; i < row.length; i++) row[i] = result.getObject(i + 1); rows.add(row); }
            return new ResultCursor(columns, rows);
        } catch (SQLException e) { throw failure(e); }
    }

    // ---------------- 事务 ----------------

    public synchronized void beginTransaction() {
        requireAccess();
        try { if (!connection.getAutoCommit()) throw new SQLiteException("Nested transactions are not supported"); connection.setAutoCommit(false); transactionSuccessful = false; transactionOwner = Thread.currentThread(); }
        catch (SQLException e) { throw failure(e); }
    }

    public void beginTransactionNonExclusive() { beginTransaction(); }

    public synchronized void endTransaction() {
        requireAccess();
        try { if (connection.getAutoCommit()) throw new SQLiteException("No active transaction");
            if (transactionSuccessful) connection.commit(); else connection.rollback(); connection.setAutoCommit(true); transactionOwner = null; transactionSuccessful = false; }
        catch (SQLException e) { throw failure(e); }
    }

    public synchronized void setTransactionSuccessful() { requireAccess(); if (!inTransaction()) throw new SQLiteException("No active transaction"); if (transactionSuccessful) throw new SQLiteException("Transaction already marked successful"); transactionSuccessful = true; }

    public synchronized boolean inTransaction() { return transactionOwner == Thread.currentThread(); }

    private void requireAccess() {
        if (!open) throw new SQLiteException("Database is closed");
        // This adapter uses one connection, not Android's per-thread pool.
        // Never let another thread accidentally join, commit or roll back it.
        if (transactionOwner != null && transactionOwner != Thread.currentThread()) throw new SQLiteException("Cross-thread access during a transaction is not supported");
    }
    private static void requireDefaultFactory(CursorFactory factory) {
        if (factory != null) throw new SQLiteException("Custom Android CursorFactory is not supported");
    }

    // ---------------- 版本号 ----------------

    public int getVersion() { Cursor c = select("PRAGMA user_version", null); try { c.moveToFirst(); return c.getInt(0); } finally { c.close(); } }

    public void setVersion(int version) { execSQL("PRAGMA user_version=" + version); }

    public long getMaximumSize() { throw new SQLiteException("getMaximumSize is not supported"); }

    public long setMaximumSize(long numBytes) { throw new SQLiteException("setMaximumSize is not supported"); }

    public void setLocale(java.util.Locale locale) { throw new SQLiteException("Android localized collations are not supported"); }

    public void setLockingEnabled(boolean lockingEnabled) { if (!lockingEnabled) throw new SQLiteException("Disabling connection locking is not supported"); }

    public void disableWriteAheadLogging() { }

    public boolean enableWriteAheadLogging() { return false; }

    public boolean isWriteAheadLoggingEnabled() { return false; }

    // ---------------- 内部：空结果集 ----------------

    /** 永远返回 0 行的 Cursor —— 等价于"表里没有数据"，是桌面版最安全的语义 */
    public static class EmptyCursor implements Cursor {
        @Override public int getCount() { return 0; }
        @Override public int getPosition() { return -1; }
        @Override public boolean moveToFirst() { return false; }
        @Override public boolean moveToNext() { return false; }
        @Override public boolean moveToPrevious() { return false; }
        @Override public boolean moveToPosition(int position) { return false; }
        @Override public boolean isFirst() { return false; }
        @Override public boolean isLast() { return false; }
        @Override public boolean isBeforeFirst() { return true; }
        @Override public boolean isAfterLast() { return true; }
        @Override public int getColumnCount() { return 0; }
        @Override public String getColumnName(int columnIndex) { return null; }
        @Override public String[] getColumnNames() { return new String[0]; }
        @Override public int getColumnIndex(String columnName) { return -1; }
        @Override public int getColumnIndexOrThrow(String columnName) { return -1; }
        @Override public String getString(int columnIndex) { return null; }
        @Override public short getShort(int columnIndex) { return 0; }
        @Override public int getInt(int columnIndex) { return 0; }
        @Override public long getLong(int columnIndex) { return 0L; }
        @Override public float getFloat(int columnIndex) { return 0f; }
        @Override public double getDouble(int columnIndex) { return 0d; }
        @Override public byte[] getBlob(int columnIndex) { return null; }
        @Override public boolean isNull(int columnIndex) { return true; }
        @Override public int getType(int columnIndex) { return 0; }
        @Override public void close() { }
        @Override public boolean isClosed() { return false; }
        @Override public boolean isNull() { return true; }
        @Override public void deactivate() { }
        @Override public int getInt() { return 0; }
        @Override public String getString() { return null; }
    }

    /** CursorFactory stub —— 与 android.database.sqlite.CursorFactory 同包，供 open* 签名使用 */
    public interface CursorFactory {
        Cursor newCursor(SQLiteDatabase db, SQLiteCursorDriver masterQuery, String editTable, SQLiteQuery query);
    }
}

package android.database.sqlite;

import java.util.List;

/** Detached JDBC result: no live statement/connection leaks after rawQuery. */
final class ResultCursor extends SQLiteDatabase.EmptyCursor {
    private final String[] columns;
    private final List<Object[]> rows;
    private int position = -1;
    private boolean closed;
    ResultCursor(String[] columns, List<Object[]> rows) { this.columns = columns; this.rows = rows; }
    private Object value(int column) {
        if (closed || position < 0 || position >= rows.size()) throw new IllegalStateException("Cursor has no current row");
        return rows.get(position)[column];
    }
    private Number number(int column) { Object v = value(column); return v == null ? 0 : v instanceof Number ? (Number)v : Double.valueOf(v.toString()); }
    @Override public int getCount() { return rows.size(); }
    @Override public int getPosition() { return position; }
    @Override public boolean moveToPosition(int position) { this.position = Math.max(-1, Math.min(position, rows.size())); return this.position >= 0 && this.position < rows.size(); }
    @Override public boolean moveToFirst() { return moveToPosition(0); }
    @Override public boolean moveToNext() { return moveToPosition(position + 1); }
    @Override public boolean moveToPrevious() { return moveToPosition(position - 1); }
    @Override public boolean isFirst() { return !rows.isEmpty() && position == 0; }
    @Override public boolean isLast() { return !rows.isEmpty() && position == rows.size() - 1; }
    @Override public boolean isBeforeFirst() { return rows.isEmpty() || position == -1; }
    @Override public boolean isAfterLast() { return rows.isEmpty() || position == rows.size(); }
    @Override public int getColumnCount() { return columns.length; }
    @Override public String getColumnName(int column) { return columns[column]; }
    @Override public String[] getColumnNames() { return columns.clone(); }
    @Override public int getColumnIndex(String name) { for (int i = 0; i < columns.length; i++) if (columns[i].equalsIgnoreCase(name)) return i; return -1; }
    @Override public int getColumnIndexOrThrow(String name) { int i = getColumnIndex(name); if (i < 0) throw new IllegalArgumentException("Unknown column: " + name); return i; }
    @Override public String getString(int column) { Object v = value(column); return v == null ? null : v.toString(); }
    @Override public short getShort(int column) { return number(column).shortValue(); }
    @Override public int getInt(int column) { return number(column).intValue(); }
    @Override public long getLong(int column) { return number(column).longValue(); }
    @Override public float getFloat(int column) { return number(column).floatValue(); }
    @Override public double getDouble(int column) { return number(column).doubleValue(); }
    @Override public byte[] getBlob(int column) { return (byte[])value(column); }
    @Override public boolean isNull(int column) { return value(column) == null; }
    @Override public int getType(int column) { Object v = value(column); return v == null ? 0 : v instanceof byte[] ? 4 : v instanceof Float || v instanceof Double ? 2 : v instanceof Number ? 1 : 3; }
    @Override public void close() { closed = true; }
    @Override public boolean isClosed() { return closed; }
    @Override public boolean isNull() { return isNull(0); }
    @Override public void deactivate() { close(); }
    @Override public int getInt() { return getInt(0); }
    @Override public String getString() { return getString(0); }
}

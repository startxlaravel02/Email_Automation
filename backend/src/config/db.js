const mysql = require("mysql2/promise");

// MySQL connection pool (MVP). Settings come from .env; a pool is created lazily
// so requiring this file doesn't open a connection until a query runs.
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ai_email_assistant",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

// Verify the database is reachable — used at startup to surface config problems
// with a clear message instead of a mysterious failure on the first query.
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log(`[db] connected to "${process.env.DB_NAME || "ai_email_assistant"}"`);
}

module.exports = { pool, testConnection };

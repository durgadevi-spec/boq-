import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// @ts-ignore
if (!process.env.DATABASE_URL) {
  // @ts-ignore
  throw new Error("DATABASE_URL is not set. Please configure it in your env.");
}

export default defineConfig({
  // Folder where Drizzle will generate SQL migration files
  out: "./migrations",

  // Path to your schema file
  schema: "./shared/schema.ts",

  // Database type
  dialect: "postgresql",

  // Database connection
  dbCredentials: {
    // @ts-ignore
    url: process.env.DATABASE_URL,
  },

  // Optional but recommended
  verbose: true,
  strict: true,
});

import "dotenv/config";
import { Client, type CreateDatabaseParameters } from "@notionhq/client";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { buildDatabaseProperties } from "./notion.properties.js";

const setupEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_PARENT_PAGE_ID: z.string().min(1),
});

export async function setupNotionDatabase(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const parsed = setupEnvSchema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(message);
  }
  const notion = new Client({ auth: parsed.data.NOTION_TOKEN });
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parsed.data.NOTION_PARENT_PAGE_ID },
    title: [{ type: "text", text: { content: "AI Development Tasks" } }],
    properties: buildDatabaseProperties() as CreateDatabaseParameters["properties"],
  });
  return database.id;
}

async function main(): Promise<void> {
  const databaseId = await setupNotionDatabase();
  process.stdout.write(`NOTION_TASK_DATABASE_ID=${databaseId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "setup failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

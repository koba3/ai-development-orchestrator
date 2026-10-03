import { Client } from "@notionhq/client";
import type { AppConfig } from "../config/index.js";
import { NOTION_PROPS } from "./notion.properties.js";
import { fromNotionPage, toNotionProperties, type NotionPageLike } from "./notion.mapper.js";
import type { TaskStore } from "../tasks/task.store.js";
import type { NewTask, Task } from "../tasks/task.types.js";
import type { AppLogger } from "../utils/logger.js";

export class NotionService implements TaskStore {
  private readonly client: Client;

  constructor(
    config: Pick<AppConfig, "notionToken" | "notionTaskDatabaseId">,
    private readonly logger: AppLogger,
    private readonly databaseId = config.notionTaskDatabaseId,
  ) {
    this.client = new Client({ auth: config.notionToken });
  }

  async findBySourceMessage(sourceMessageTs: string, slackChannel: string): Promise<Task[]> {
    const response = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        and: [
          {
            property: NOTION_PROPS.sourceMessageTs,
            rich_text: { equals: sourceMessageTs },
          },
          {
            property: NOTION_PROPS.slackChannel,
            rich_text: { equals: slackChannel },
          },
        ],
      },
      page_size: 100,
    });
    return response.results.flatMap((result) => {
      if (result.object !== "page" || !("properties" in result)) {
        return [];
      }
      return [fromNotionPage(result as NotionPageLike)];
    });
  }

  async insert(task: NewTask): Promise<Task> {
    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: toNotionProperties(task) as Parameters<Client["pages"]["create"]>[0]["properties"],
    });
    if (!("url" in page) || !("properties" in page)) {
      throw new Error(`Notion created a partial page for ${task.taskId}`);
    }
    this.logger.info(
      { taskId: task.taskId, agentType: task.agentType, event: "notion.page.created", status: task.status },
      "notion page created",
    );
    return fromNotionPage(page as NotionPageLike);
  }
}

import { createFileRoute } from "@tanstack/react-router";
import { UnreadThreads } from "../features/notifications/UnreadThreads";
import { useDocumentTitle } from "../useDocumentTitle";

const UnreadThreadsPage = () => {
  useDocumentTitle("未读对话");
  return <UnreadThreads />;
};

export const Route = createFileRoute("/unread")({ component: UnreadThreadsPage });

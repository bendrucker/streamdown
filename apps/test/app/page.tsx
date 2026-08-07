import { gateway } from "@ai-sdk/gateway";
import { Chat } from "./components/chat";

// The model list needs a gateway credential that only exists at runtime.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { models } = await gateway.getAvailableModels();
  const list = models
    .filter((model) => !model.name.includes("embed"))
    .map((model) => ({
      label: model.name,
      value: model.id,
    }));

  return <Chat models={list} />;
}

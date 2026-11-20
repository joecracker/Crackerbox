import { type Template, localTemplatesData } from "../../shared/templates";

// Crackerbox ships its own template list. It does not fetch community
// templates from anyone else's server.
export async function getAllTemplates(): Promise<Template[]> {
  return localTemplatesData;
}

export async function getTemplateOrThrow(
  templateId: string,
): Promise<Template> {
  const allTemplates = await getAllTemplates();
  const template = allTemplates.find((template) => template.id === templateId);
  if (!template) {
    throw new Error(
      `Template ${templateId} not found. Please select a different template.`,
    );
  }
  return template;
}

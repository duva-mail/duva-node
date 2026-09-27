// Récupère les fixtures publiques de `duva-mail/duva-conformance` (générées et testées dans le
// dépôt `duva` : voir docs/bibliotheques-clientes.md §6). Jamais commitées ici (voir .gitignore) :
// toujours la version la plus fraîche, jamais une copie qui pourrait dériver silencieusement.
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://raw.githubusercontent.com/duva-mail/duva-conformance/main";
const FILES = ["webhooks.json", "requests.json", "retries.json"];

await mkdir("conformance", { recursive: true });
for (const name of FILES) {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`fetching ${name}: HTTP ${response.status}`);
  await writeFile(`conformance/${name}`, await response.text());
  console.log(`conformance/${name} fetched`);
}

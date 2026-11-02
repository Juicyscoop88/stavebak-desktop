/**
 * Co je ve zprávě k odeslání: text, příkaz (prefix) nebo přílohy. Samotný snímek obrazovky
 * bez textu je platná zpráva, model dostane cesty k souborům pod nadpisem.
 */
export function hasSendableContent(text: string, hasPrefix: boolean, fileCount: number): boolean {
  return text.trim().length > 0 || hasPrefix || fileCount > 0;
}

/** Text zprávy s připojenými soubory (cesta na řádek); bez textu jen nadpis a cesty. */
export function withAttachedFiles(text: string, paths: string[], heading: string): string {
  if (paths.length === 0) return text;
  const list = `${heading}\n${paths.join('\n')}`;
  return text ? `${text}\n\n${list}` : list;
}

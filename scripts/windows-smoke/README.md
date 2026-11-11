# Windows zkouška na skutečné ploše

Testy, které CI neumí: skutečné okna, myš a klávesnice v přihlášené session Windows. Spouští se před vydáním desktopu, stojí pár korun za běh EC2.

```bash
export STAVEBAK_WIN_INSTANCE=<ID instance>
export STAVEBAK_WIN_BUCKET=<soukromý bucket>
export AWS_REGION=eu-central-1

scripts/windows-smoke/run.sh provision   # jen poprvé, desítky minut
scripts/windows-smoke/run.sh             # zkouška, na konci vypíše výsledek a složku s výstupy
```

`run.sh` server nastartuje, nahraje pracovní kopii repa, spustí `vitest`, `cargo test --lib` a testy `real_windows_*` na ploše a server vždy zastaví. Výsledek je v exit kódu a v řádku `SMOKE_RESULT`.

## Co je potřeba v AWS

- EC2 Windows Server 2022 (t3.xlarge, 120 GB), bez příchozích portů, s přístupem na internet.
- Instanční role: `AmazonSSMManagedInstanceCore` a čtení a zápis do bucketu.
- Soukromý S3 bucket jen pro tuhle zkoušku.

Účet, ID instance ani název bucketu do repa nepatří, repo je veřejné. `autologon.ps1` nastaví náhodné heslo, které je jen v registru jednorázového stroje.

## Co testy kontrolují

Výsledek, ne odeslání kláves: uložený soubor (Poznámkový blok, Malování, LibreOffice Writer a Calc) nebo změnu výkresu (LibreCAD). Výstupy jsou snímky `*.jpg` a logy, po běhu se na snímky podívat.

Word, Excel ani BricsCAD na stroji nejsou, potřebují licenci. Poznámky k prostředí: obrazovka je 1024×768 a okna se do ní musí vejít, škálování nech na 100 %.

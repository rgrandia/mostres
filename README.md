# Generador de mostres

Aplicatiu web per dissenyar mostres per quotes a partir del cens per agrupació
censal d'Idescat i exportar-les a un llibre Excel viu (fórmules, no valors
enganxats), amb la mateixa estructura que els llibres `NNNN_EnqMunicipi_AAAA_Mostra.xlsx`.

Funciona sense servidor: obre `index.html` (o la versió publicada) i tot es
calcula al navegador.

## Què fa

1. **Base de dades**: porta inclosa la base `censph16354ac` (2021-2025, 247
   municipis, 854 agrupacions censals, per nacionalitat). Es pot carregar una
   base nova (CSV, ZIP o XLSX en format llarg) des del mateix aplicatiu; queda
   desada al navegador.
2. **Àmbit i zones**: un o diversos municipis; cada agrupació censal es pot
   reanomenar, agrupar amb altres (mateix nom de zona) o excloure. Opcionalment,
   el pes de les zones s'ajusta per iteració (IPF) a una població externa
   (p. ex. el padró per nuclis que dona el client).
3. **Univers**: edat mínima i màxima, franges d'edat (la franja partida es
   prorrateja: 18-19 = 2/5 de 15-19) i nacionalitats incloses.
4. **Taules i creuaments**: taula principal (zones × fins a tres variables:
   sexe, edat, origen) i taules addicionals, derivades (suma de la principal) o
   independents (quota marginal, quadrada amb el total de cada zona).
5. **Mostra**: N, arrodoniment (restes majors o ROUND directe), llindar d'avís
   de cel·les petites i repartiment CAWI/CATI.
6. **Diagnòstic**: suma vs N, cel·les inviables, categories que desapareixen,
   error mostral total i per zona, dades confidencials del cens i avisos sobre la
   definició de l'univers.

## L'Excel

- `Resum`: la N a `B4` (groga, editable), suma i diferència, error mostral i
  totes les taules.
- `Càlcul`: univers, `ROUND(univers / total × N)`, ajust d'arrodoniment (cel·les
  grogues editables, calculat per restes majors per a la N de l'aplicatiu) i
  quota final. Si es canvia la N a l'Excel, `Resum!A5` avisa que l'ajust s'ha de
  revisar.
- `Disseny`: els paràmetres i la configuració en JSON.
- `Font - cens AAAA`: les files del cens utilitzades, com a valors.

## Actualitzar la base inclosa

```bash
node tools/build-base.js ruta/al/cens.zip   # o .csv
node tests/engine.test.js                    # comprova que tot quadra
```

## Tests

`node tests/engine.test.js` reprodueix l'estudi de Sant Pere de Ribes 2026
(N=400, espanyols de 18 anys i més, pes de zones del client): pesos IPF i quotes
finals idèntics a la plantilla.

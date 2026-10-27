# Generador de mostres

Amb l'estil de GESOP (blau corporatiu, Montserrat, logotip a `img/`).

Aplicatiu web per dissenyar mostres per quotes a partir del cens per agrupació
censal d'Idescat i exportar-les a un llibre Excel viu (fórmules, no valors
enganxats), amb la mateixa estructura que els llibres `NNNN_EnqMunicipi_AAAA_Mostra.xlsx`.

Funciona sense servidor: obre `index.html` (o la versió publicada) i tot es
calcula al navegador.

## Desplegament a Vercel

És un lloc estàtic: no cal compilar res ni cap servidor.

1. A [vercel.com/new](https://vercel.com/new), importa el repositori `rgrandia/mostres`.
2. Deixa *Framework Preset* = **Other** i no omplis ni *Build Command* ni
   *Output Directory* (ja ho fixa `vercel.json`).
3. *Deploy*. Cada push a `main` torna a desplegar automàticament.

Per limitar-ne l'accés a l'equip, activa *Settings → Deployment Protection*
(Vercel Authentication) al projecte.

Les llibreries (ExcelJS 4.4.0 i JSZip 3.10.1) són a `vendor/`, de manera que
l'aplicatiu no depèn de cap CDN extern (només les fonts de Google, amb
alternatives del sistema si no carreguen).

## Què fa

1. **Base de dades**: porta inclosa la base `censph16354ac` (2021-2025, 247
   municipis, 854 agrupacions censals, per nacionalitat). Es pot carregar
   qualsevol altra taula en format llarg (CSV, ZIP o XLSX), que queda desada al
   navegador. Només calen una columna de valor i alguna variable: l'aplicatiu
   detecta quines n'hi ha (any, zona, edat, origen/nacionalitat/lloc de
   naixement o concepte, sexe) i amaga les opcions de les que falten. Qualsevol
   altra columna amb categories (p. ex. «nivell d'estudis») es pot creuar a les
   taules amb el nom de la columna; no s'ofereixen les que semblen codis, les que
   només descriuen la zona ni les de més de 40 categories. Si la
   taula dona percentatges en lloc de persones (p. ex. `censph16401cat`), les
   quotes reprodueixen les proporcions i l'aplicatiu avisa de les limitacions
   (sense univers en persones, sexes amb el mateix pes, categories que no sumen
   100%).
2. **Àmbit i zones**: un o diversos municipis. «Organitza els districtes» obre
   un editor on s'arrosseguen les agrupacions censals a un districte o a «Nou
   districte» (o es marquen i es mouen amb la barra d'accions, també en pantalles
   tàctils). Cada agrupació que no és en cap districte és una zona per si sola.
   Mostra l'univers de cada agrupació i la quota de cada districte per poder-los
   equilibrar. Opcionalment, el pes de les zones s'ajusta per iteració (IPF) a una
   població externa (p. ex. el padró per nuclis que dona el client).
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
- `Disseny`: els paràmetres, la composició de cada zona (agrupacions i univers)
  i la configuració en JSON. Les zones agrupades també es llisten a les notes del
  `Resum`.
- `Font - cens AAAA`: les files del cens utilitzades, com a valors.

## Actualitzar la base inclosa

Una base carregada des de l'aplicatiu només queda desada en aquell navegador.
Perquè tot l'equip tingui la base nova per defecte, cal regenerar
`data/cens-base.js` i fer push a `main` (Vercel la publica sola):

```bash
node tools/build-base.js ruta/al/cens.zip   # o .csv
node tests/engine.test.js                    # comprova que tot quadra
```

## Tests

`node tests/engine.test.js` reprodueix l'estudi de Sant Pere de Ribes 2026
(N=400, espanyols de 18 anys i més, pes de zones del client): pesos IPF i quotes
finals idèntics a la plantilla.

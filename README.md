# Bluesky Hedonometer and Entropometer

Daily measures of the language of Bluesky, computed from every public post:

- **Happiness** (the hedonometer): the average [LabMT](https://www.pnas.org/doi/10.1073/pnas.1411678112#supplementary-materials)
  score of the words in each day's posts, ignoring neutral words (scores 4–6), on a 1–9 scale.
  Each day also has a word shift showing which words moved happiness against up to 7 previous days.
- **Entropy rate** (the entropometer): how predictable the language is, in bits per word, estimated
  with [ProcessEntropy](https://pypi.org/project/ProcessEntropy/) on a fixed 1M-word random sample per day.

Both are published per language, with hourly values (UTC) for every day.

**Site:** https://lewismath.github.io/hedonometer-blue/

This repository is the published site: the page itself (`index.html`, `assets/`) and the data
(`data/`). It is updated automatically once a day closes. Only aggregates are published: no posts,
handles or account identifiers.

## Data files

Everything is under [`data/`](data/):

| File | Contents |
|---|---|
| `hedonometer-blue-daily.csv` | Every daily value, one row per day × language × meter (columns below). |
| `index.json` | First and last date, method version, lexicon revision, and the languages with their meters. |
| `<lang>/daily.json` | Columnar daily series for one language: `dates`, `happiness`, `entropy`, `posts`, `happiness_words`, `entropy_tokens`, `coverage` (`complete` or `partial`) and `gap_hours`. |
| `<lang>/days/<date>.json` | One day's hourly values (UTC) per meter, with the words or tokens behind each hour and each hour's state (`complete`, `gap`, …). |
| `<lang>/shifts/<date>.json` | The day's word shift as a Vega-Lite spec, produced by [wordlevel](https://github.com/ryanjgallagher/wordlevel). |

`<lang>` is a language code (`en`, `de`, …), or `all` for every post regardless of language
(entropy only). Dates are UTC days.

### CSV columns

`date,language,meter,value,posts,count,complete_hours,partial`

| Column | Meaning |
|---|---|
| `date` | UTC day, `YYYY-MM-DD` |
| `language` | language code, or `all` |
| `meter` | `happiness` or `entropy` |
| `value` | average happiness (1–9), or entropy rate (bits per word) |
| `posts` | posts in that language that day |
| `count` | LabMT words scored (happiness), or tokens (entropy) |
| `complete_hours` | hours of the day with complete data (out of 24) |
| `partial` | `1` if any hour is missing, else `0` |

Days without a value are left out of the CSV, and are gaps in the charts.

## Licences

- **Code** (the page: `index.html`, `assets/`): MIT, see [LICENSE](LICENSE).
- **Data** (`data/`): [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/),
  following the LabMT lexicon's licence.

## Citations

Data source: Bluesky Jetstream.

- LabMT: Dodds et al. [2011](https://doi.org/10.1371/journal.pone.0026752),
  [2015](https://www.pnas.org/doi/10.1073/pnas.1411678112)
  ([word lists](https://www.pnas.org/doi/10.1073/pnas.1411678112#supplementary-materials); CC BY-NC-SA 4.0).
- Word shifts: [wordlevel](https://github.com/ryanjgallagher/wordlevel);
  [Gallagher et al. 2021](https://link.springer.com/content/pdf/10.1140/epjds/s13688-021-00260-3.pdf).
- Entropy rate: [ProcessEntropy](https://pypi.org/project/ProcessEntropy/);
  [Bagrow, Liu & Mitchell 2019](https://www.nature.com/articles/s41562-018-0510-5);
  [South, Smart, Roughan & Mitchell 2022](https://www.sciencedirect.com/science/article/pii/S2468696422000337).

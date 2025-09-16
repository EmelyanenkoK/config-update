# Blockchain Config Smart Contract

## Install Dependencies

`npm install`

## Compile Contracts

`npm run build`

## Run Tests

`npm run test`

## Manual Build

Install FunC 4.6.0 binaries and related Fift binaries.

Compile: `func -SPA -o config.fif stdlib.fc config-code.fc`. Compiled Fift code will be in `config.fif`.

Print: `fift -s print-hex.fif` - Print code hash and BOC data in HEX.
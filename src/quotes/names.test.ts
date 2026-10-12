import { describe, expect, it } from 'vitest'
import { distinctiveWords, listingRank, sameFund, searchQueries } from './names'

describe('reconocer el mismo fondo en otra bolsa', () => {
  const world = 'iShares Core MSCI World UCITS ETF USD (Acc)'
  const sp500 = 'iShares Core S&P 500 UCITS ETF USD (Acc)'

  it('las palabras que distinguen un fondo no incluyen gestora ni producto', () => {
    expect(distinctiveWords(world)).toEqual(['core', 'msci', 'world'])
    expect(distinctiveWords(sp500)).toEqual(['core', '500'])
  })

  it('el mismo fondo con el nombre abreviado de otra bolsa', () => {
    expect(sameFund(world, 'ISHSIII-CORE MSCI WORLD U.ETF')).toBe(true)
    expect(sameFund(world, 'iShares Core MSCI World UCITS ETF USD (Acc)')).toBe(true)
    expect(sameFund(sp500, 'ISHSVII-CORE S&P500 U.ETF')).toBe(true)
  })

  it('otro fondo parecido no cuenta', () => {
    expect(sameFund(world, 'iShares MSCI World SRI UCITS ETF')).toBe(false) // falta «core» y es ESG
    expect(sameFund(world, 'iShares Core MSCI World UCITS ETF USD (Dist)')).toBe(false) // otra clase
    expect(sameFund(world, 'iShares Core MSCI World UCITS ETF EUR Hedged (Acc)')).toBe(false) // cubierto
    expect(sameFund(world, 'iShares Core S&P 500 UCITS ETF USD (Acc)')).toBe(false)
    expect(sameFund(sp500, 'iShares Core MSCI World UCITS ETF USD (Acc)')).toBe(false)
  })

  it('si el fondo de referencia sí es de distribución, su misma clase vale', () => {
    expect(sameFund('iShares Core S&P 500 UCITS ETF USD (Dist)', 'ISHSVII-CORE S&P500 U.ETF DIST')).toBe(true)
  })

  it('busca por el nombre entero y por el nombre sin «UCITS ETF…»', () => {
    expect(searchQueries(world)).toEqual([world, 'iShares Core MSCI World'])
    expect(searchQueries('Apple Inc.')).toEqual(['Apple Inc.'])
  })

  it('un ETF europeo (UCITS) no es el estadounidense del mismo índice', () => {
    expect(sameFund(sp500, 'iShares Core S&P 500 ETF')).toBe(false) // IVV
    expect(sameFund(sp500, 'iShares Trust - iShares Core S&P 500 ETF')).toBe(false)
    expect(sameFund(sp500, 'iShares Core S&P 500 UCITS ETF')).toBe(true) // truncado en una bolsa secundaria
    expect(sameFund(world, 'iShares Core MSCI World UCITS E')).toBe(true) // nombre cortado a 31 caracteres
  })

  it('las bolsas principales van antes que las secundarias', () => {
    const order = ['IVV.SN', 'EUNLD.XD', 'IWDA.L', 'IWDA.AS', 'EUNL.DE', 'X'].sort((a, b) => listingRank(a) - listingRank(b))
    expect(order).toEqual(['EUNL.DE', 'IWDA.AS', 'IWDA.L', 'IVV.SN', 'EUNLD.XD', 'X'])
  })
})

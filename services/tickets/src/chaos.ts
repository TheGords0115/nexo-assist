/**
 * Simula a instabilidade do sistema legado ("de vez em quando fica indisponível por alguns segundos").
 * Uma fração das requisições responde 503 depois de um atraso, e há janelas curtas em que tudo falha.
 * Configurável por variáveis de ambiente para poder desligar nos testes.
 */
export interface ChaosOptions {
  /** Probabilidade de uma requisição isolada falhar (0 a 1). */
  failureRate: number
  /** Probabilidade de abrir uma janela de indisponibilidade a cada requisição. */
  outageRate: number
  /** Duração da janela de indisponibilidade. */
  outageMs: number
  /** Atraso extra (máximo) das respostas, para parecer um sistema legado. */
  maxLatencyMs: number
  random?: () => number
  now?: () => number
}

export class Chaos {
  private outageUntil = 0
  constructor(private readonly opts: ChaosOptions) {}

  static fromEnv(env: NodeJS.ProcessEnv): Chaos {
    return new Chaos({
      failureRate: Number(env.TICKETS_FAILURE_RATE ?? 0.08),
      outageRate: Number(env.TICKETS_OUTAGE_RATE ?? 0.02),
      outageMs: Number(env.TICKETS_OUTAGE_MS ?? 4000),
      maxLatencyMs: Number(env.TICKETS_MAX_LATENCY_MS ?? 250),
    })
  }

  static off(): Chaos {
    return new Chaos({ failureRate: 0, outageRate: 0, outageMs: 0, maxLatencyMs: 0 })
  }

  /** Decide o destino da requisição: segue normalmente ou responde "indisponível". */
  roll(): { fail: boolean; latencyMs: number } {
    const random = this.opts.random ?? Math.random
    const now = (this.opts.now ?? Date.now)()
    const latencyMs = Math.round(random() * this.opts.maxLatencyMs)
    if (now < this.outageUntil) return { fail: true, latencyMs }
    if (random() < this.opts.outageRate) {
      this.outageUntil = now + this.opts.outageMs
      return { fail: true, latencyMs }
    }
    return { fail: random() < this.opts.failureRate, latencyMs }
  }
}

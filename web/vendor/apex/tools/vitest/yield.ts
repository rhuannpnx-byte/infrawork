/**
 * DV-008: depois de cada teste, devolve o controle ao laço de eventos (macrotarefa).
 * O Vitest encadeia testes síncronos só com microtarefas; os 27 testes de oráculo de um arquivo viravam
 * um bloco síncrono único que, sob carga, passava de 60 s. A resposta do RPC ("onTaskUpdate") chegava
 * mas ficava na fila, e o temporizador de 60 s do worker disparava antes dela.
 */
import { afterEach } from "vitest";

afterEach(() => new Promise<void>((r) => setImmediate(r)));

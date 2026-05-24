import axios, { type AxiosInstance } from 'axios'

/**
 * Cliente HTTP genérico.
 *
 * Hoje em dia o backend primário é o Supabase (ver `lib/supabase/`). Este
 * client fica aqui pra integrações com serviços REST adicionais futuros.
 * Quando for usado, configure `VITE_API_URL`.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: 10000
})

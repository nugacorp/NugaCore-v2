/**
 * Se inyecta en build desde el mismo WIREGUARD_MULTITENANT que usa Express.
 * Así el bundle no presenta ni consulta superficies v2 durante flag-off.
 */
export const WIREGUARD_MULTITENANT_UI_ENABLED = __WIREGUARD_MULTITENANT__;

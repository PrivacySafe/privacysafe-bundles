import { markRaw } from 'vue';
import { useRoute, useRouter, type Router, type RouteLocationNormalizedLoaded } from 'vue-router';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $route: RouteLocationNormalizedLoaded;
    $router: Router;
  }
}

export function piniaRouter() {
  const router = useRouter();
  const route = useRoute();

  return {
    $route: markRaw(route),
    $router: markRaw(router),
  };
}

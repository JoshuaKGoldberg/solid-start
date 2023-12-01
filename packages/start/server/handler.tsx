import { renderToStream } from "solid-js/web";
import { provideRequestEvent } from "solid-js/web/storage";
import {
  eventHandler,
  EventHandlerObject,
  EventHandlerRequest,
  H3Event,
  setHeader,
  setResponseStatus
} from "vinxi/server";
import { apiRoutes } from "../shared/routes";
import { getFetchEvent } from "./middleware";
import { createPageEvent } from "./page-event";
import { FetchEvent, PageEvent } from "./types";

export function createHandler(
  fn: (context: PageEvent) => unknown,
  options: {
    nonce?: string;
    renderId?: string;
    timeoutMs?: number;
    onCompleteAll?: (options: { write: (v: any) => void }) => void;
    onCompleteShell?: (options: { write: (v: any) => void }) => void;
    createPageEvent?: (event: FetchEvent) => Promise<PageEvent>;
    onRequest?: EventHandlerObject["onRequest"];
    onBeforeResponse?: EventHandlerObject["onBeforeResponse"];
  } = {}
) {
  return eventHandler({
    onRequest: options.onRequest,
    onBeforeResponse: options.onBeforeResponse,
    handler: (e: H3Event<EventHandlerRequest> & { startEvent: FetchEvent }) => {
      const event = getFetchEvent(e);

      return provideRequestEvent(event, async () => {
        // api
        const match = apiRoutes.find(
          route =>
            route[`$${event.request.method}`] && new URL(event.request.url).pathname === route.path
        );
        if (match) {
          const mod = await match[`$${event.request.method}`].import();
          const fn = mod[event.request.method];
          const result = await fn(event);
          return result;
        }

        // render stream
        const context = await createPageEvent(event);
        let cloned = { ...options };
        if (cloned.onCompleteAll) {
          const og = cloned.onCompleteAll;
          cloned.onCompleteAll = options => {
            handleStreamCompleteRedirect(context)(options);
            og(options);
          };
        } else cloned.onCompleteAll = handleStreamCompleteRedirect(context);
        if (cloned.onCompleteShell) {
          const og = cloned.onCompleteShell;
          cloned.onCompleteShell = options => {
            handleShellCompleteRedirect(context, e)();
            og(options);
          };
        } else cloned.onCompleteShell = handleShellCompleteRedirect(context, e);
        const stream = renderToStream(() => fn(context), cloned);
        if (context.response && context.response.headers.get("Location")) {
          return event.redirect(context.response.headers.get("Location"));
        }
        return { pipeTo: stream.pipeTo };
      });
    }
  });
}

function handleShellCompleteRedirect(context: PageEvent, e: H3Event<EventHandlerRequest>) {
  return () => {
    if (context.response && context.response.headers.get("Location")) {
      setResponseStatus(e, 302);
      setHeader(e, "Location", context.response.headers.get("Location"));
    }
  }
}

function handleStreamCompleteRedirect(context: PageEvent) {
  return ({ write }: { write: (html: string) => void }) => {
    const to = context.response && context.response.headers.get("Location");
    to && write(`<script>window.location="${to}"</script>`);
  };
}
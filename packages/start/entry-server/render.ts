import { JSX } from "solid-js";
import { renderToStream, renderToString, renderToStringAsync } from "solid-js/web";
import { redirect } from "../server/responses";
import { FetchEvent, FETCH_EVENT, PageEvent } from "../server/types";

export function renderSync(
  fn: (context: PageEvent) => JSX.Element,
  options?: {
    nonce?: string;
    renderId?: string;
  }
) {
  return () => async (event: FetchEvent) => {
    if (!import.meta.env.DEV && !import.meta.env.START_SSR && !import.meta.env.START_INDEX_HTML) {
      return await event.env.getStaticHTML("/index");
    }

    let pageEvent = createPageEvent(event);

    let markup = renderToString(() => fn(pageEvent), options);
    if (pageEvent.routerContext.url) {
      return redirect(pageEvent.routerContext.url, {
        headers: pageEvent.responseHeaders
      });
    }

    markup = handleIslandsRouting(pageEvent, markup);

    return new Response(markup, {
      status: pageEvent.getStatusCode(),
      headers: pageEvent.responseHeaders
    });
  };
}

export function renderAsync(
  fn: (context: PageEvent) => JSX.Element,
  options?: {
    timeoutMs?: number;
    nonce?: string;
    renderId?: string;
  }
) {
  return () => async (event: FetchEvent) => {
    if (!import.meta.env.DEV && !import.meta.env.START_SSR && !import.meta.env.START_INDEX_HTML) {
      return await event.env.getStaticHTML("/index");
    }

    let pageEvent = createPageEvent(event);

    let markup = await renderToStringAsync(() => fn(pageEvent), options);

    if (pageEvent.routerContext.url) {
      return redirect(pageEvent.routerContext.url, {
        headers: pageEvent.responseHeaders
      });
    }

    markup = handleIslandsRouting(pageEvent, markup);

    return new Response(markup, {
      status: pageEvent.getStatusCode(),
      headers: pageEvent.responseHeaders
    });
  };
}

export function renderStream(
  fn: (context: PageEvent) => JSX.Element,
  baseOptions: {
    nonce?: string;
    renderId?: string;
    onCompleteShell?: (info: { write: (v: string) => void }) => void;
    onCompleteAll?: (info: { write: (v: string) => void }) => void;
  } = {}
) {
  return () => async (event: FetchEvent) => {
    if (!import.meta.env.DEV && !import.meta.env.START_SSR && !import.meta.env.START_INDEX_HTML) {
      return await event.env.getStaticHTML("/index");
    }

    // Hijack after navigation with islands router to be async
    // Todo streaming into HTML
    if (import.meta.env.START_ISLANDS_ROUTER && event.request.headers.get("x-solid-referrer")) {
      return renderAsync(fn, baseOptions)()(event);
    }

    let pageEvent = createPageEvent(event);

    const options = { ...baseOptions };
    if (options.onCompleteAll) {
      const og = options.onCompleteAll;
      options.onCompleteAll = options => {
        handleStreamingRedirect(pageEvent)(options);
        og(options);
      };
    } else options.onCompleteAll = handleStreamingRedirect(pageEvent);
    const { readable, writable } = new TransformStream();
    const stream = renderToStream(() => fn(pageEvent), options);

    if (pageEvent.routerContext.url) {
      return redirect(pageEvent.routerContext.url, {
        headers: pageEvent.responseHeaders
      });
    }

    stream.pipeTo(writable);

    return new Response(readable, {
      status: pageEvent.getStatusCode(),
      headers: pageEvent.responseHeaders
    });
  };
}

function handleStreamingIslandsRouting(pageEvent: PageEvent, writable: WritableStream<any>) {
  if (pageEvent.routerContext.replaceOutletId) {
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    writer.write(
      encoder.encode(
        `${pageEvent.routerContext.replaceOutletId}:${pageEvent.routerContext.newOutletId}=`
      )
    );
    writer.releaseLock();
    pageEvent.responseHeaders.set("Content-Type", "text/plain");
  }
}

function handleRedirect() {}

function handleStreamingRedirect(context) {
  return ({ write }) => {
    if (context.routerContext.url)
      write(`<script>window.location="${context.routerContext.url}"</script>`);
  };
}

function createPageEvent(event: FetchEvent) {
  let responseHeaders = new Headers({
    "Content-Type": "text/html"
  });

  const prevPath = event.request.headers.get("x-solid-referrer");

  let statusCode = 200;

  function setStatusCode(code: number) {
    statusCode = code;
  }

  function getStatusCode() {
    return statusCode;
  }

  const pageEvent: PageEvent = Object.freeze({
    request: event.request,
    prevUrl: prevPath,
    routerContext: {},
    tags: [],
    env: event.env,
    $type: FETCH_EVENT,
    responseHeaders,
    setStatusCode: setStatusCode,
    getStatusCode: getStatusCode,
    $islands: new Set<string>(),
    fetch: event.fetch
  });

  return pageEvent;
}

function handleIslandsRouting(pageEvent: PageEvent, markup: string) {
  if (import.meta.env.START_ISLANDS_ROUTER && pageEvent.routerContext.replaceOutletId) {
    markup = `${
      pageEvent.routerContext.assets
        ? `assets=${JSON.stringify(pageEvent.routerContext.assets)};`
        : ``
    }${pageEvent.routerContext.replaceOutletId}:${
      pageEvent.routerContext.newOutletId
    }=${markup.slice(
      markup.indexOf(`<!--${pageEvent.routerContext.newOutletId}-->`) +
        `<!--${pageEvent.routerContext.newOutletId}-->`.length +
        `<outlet-wrapper id="${pageEvent.routerContext.newOutletId}">`.length,
      markup.lastIndexOf(`<!--${pageEvent.routerContext.newOutletId}-->`) -
        `</outlet-wrapper>`.length
    )}`;

    pageEvent.responseHeaders.set("Content-Type", "text/solid-diff");
    pageEvent.responseHeaders.set("x-solid-location", pageEvent.request.url);
  }
  return markup;
}

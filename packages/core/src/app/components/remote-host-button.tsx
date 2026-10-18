import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import type { useRemoteHost } from '../lib/use-remote-host';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

export function RemoteHostButton({
  remote,
  onPresent,
}: {
  remote: ReturnType<typeof useRemoteHost>;
  onPresent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const starting = remote.starting;
  return (
    <>
      <button
        type="button"
        aria-label="Bedienen met telefoon"
        disabled={starting}
        className="inline-flex items-center gap-1.5 rounded-[2px] px-3 py-2 text-xs hover:bg-muted"
        onClick={() => {
          setOpen(true);
          void remote.start();
        }}
      >
        <Smartphone className="size-4" />
        <span className="hidden md:inline">Telefoon{remote.connected ? ' ✓' : ''}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-2">
          <DialogTitle>Bedienen met je iPhone</DialogTitle>
          <DialogDescription>
            Verbind je iPhone met hetzelfde netwerk. Open dit adres in Safari en voer de code in.
          </DialogDescription>
          {starting && !remote.session && (
            <p role="status" className="mt-4">
              Sessie starten…
            </p>
          )}
          {remote.error && (
            <p role="alert" className="mt-4 text-red-600">
              {remote.error}
            </p>
          )}
          {remote.session && (
            <>
              <div className="mt-4 space-y-2">
                {remote.session.urls.map((url) => (
                  <a
                    key={url}
                    href={`${url}#${remote.session?.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all rounded-[2px] bg-muted p-3 font-mono text-sm text-brand underline"
                  >
                    {url}
                  </a>
                ))}
              </div>
              {!remote.session.urls.length && (
                <p className="mt-3 text-sm">
                  Geen netwerkadres gevonden. Verbind de laptop eerst met wifi.
                </p>
              )}
              <p className="mt-5 text-center text-sm text-muted-foreground">Koppelcode</p>
              <p
                data-testid="remote-code"
                className="my-2 text-center font-mono text-4xl tracking-[0.2em]"
              >
                {remote.session.code}
              </p>
              <p role="status" className="my-4 text-center text-sm">
                {remote.connected ? '✓ Telefoon verbonden' : 'Wachten op je telefoon'}
              </p>
              <button
                type="button"
                className="w-full rounded-[2px] bg-brand px-4 py-3 font-semibold text-brand-foreground"
                onClick={() => {
                  setOpen(false);
                  onPresent();
                }}
              >
                Start presentatie
              </button>
            </>
          )}
          {(starting || remote.session) && (
            <button
              type="button"
              className="mt-3 w-full p-2 text-sm text-muted-foreground"
              onClick={() => {
                remote.stop();
                setOpen(false);
              }}
            >
              Koppeling stoppen
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

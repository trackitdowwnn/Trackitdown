/**
 * WHAT:  YourDataScreen — "Download your data" opens here: it builds (or
 *        re-signs) the export, then shows the PDF inside the app. Save hands
 *        the file to the phone's own browser, which keeps it in Downloads;
 *        links in the PDF (the JSON copy, photos, maps) open the same way.
 * WHY:   Opening the PDF link in the in-app browser showed a blank page on
 *        Android (owner, 2026-10-26): Chrome Custom Tabs can't show a PDF, and
 *        the app has no module to pass a file to a viewer app without a native
 *        build. So the app draws the PDF itself (../lib/pdfViewerHtml.ts).
 *
 *        ⚠️ THE WEBVIEW GOES NOWHERE: every navigation is refused, and only
 *        https links the PDF asks for are opened — with Linking, outside the
 *        app. The PDF's bytes are fetched here and handed over as base64, so
 *        the page never needs the signed link.
 *
 *        ⚠️ SAVE RE-ASKS WHEN THE LINK IS NEARLY OUT: the signed link lasts 15
 *        minutes; within a day the server re-signs the SAME file rather than
 *        building another (export-my-data's reuse window).
 * LINKS: src/app/your-data.tsx (the route); ../api/profileApi.ts
 *        (requestDataExport); supabase/functions/export-my-data/index.ts.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  spacing,
  sizes,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { BrandLoader, Button, ErrorState, Screen, useToast } from '@/shared/ui';

import { requestDataExport } from '../api/profileApi';
import { parsePdfViewerMessage, pdfViewerHtml } from '../lib/pdfViewerHtml';

type Status = 'loading' | 'ready' | 'error';
type ExportLink = Awaited<ReturnType<typeof requestDataExport>>;

/** Re-sign the link if it has less than this left. */
const LINK_MARGIN_MS = 60_000;

/** A file's bytes as base64, for the viewer page. */
async function fetchBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  // In chunks: one String.fromCharCode(...bytes) overflows the stack on a
  // large file.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function YourDataScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const webview = useRef<WebView>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [shown, setShown] = useState(false);
  const link = useRef<ExportLink | null>(null);
  const pdf = useRef<string | null>(null);
  const saving = useRef(false);

  // Doesn't set 'loading' itself (status starts there; see BlockedAccountsScreen).
  const load = useCallback(() => {
    requestDataExport()
      .then(async (result) => {
        pdf.current = await fetchBase64(result.url);
        link.current = result;
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    setShown(false);
    setStatus('loading');
    load();
  }, [load]);

  const html = useMemo(() => pdfViewerHtml(palette.background), [palette.background]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parsePdfViewerMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready' && pdf.current) {
      webview.current?.injectJavaScript(`window.showPdf(${JSON.stringify(pdf.current)});true;`);
    } else if (message.type === 'rendered') {
      setShown(true);
    } else if (message.type === 'error') {
      setStatus('error');
    } else if (message.type === 'open' && message.url.startsWith('https://')) {
      void Linking.openURL(message.url);
    }
  }, []);

  const save = useCallback(async () => {
    if (saving.current || !link.current) return;
    saving.current = true;
    try {
      let current = link.current;
      if (Date.parse(current.expiresAt) - Date.now() < LINK_MARGIN_MS) {
        current = await requestDataExport();
        link.current = current;
      }
      await Linking.openURL(current.url);
    } catch (error) {
      toast.show(
        error instanceof Error ? error.message : 'We couldn’t save your data. Please try again.',
        'error',
      );
    } finally {
      saving.current = false;
    }
  }, [toast]);

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="your-data-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Your data
        </Text>
        <Button
          label="Save"
          variant="ghost"
          fullWidth={false}
          disabled={!shown}
          onPress={() => void save()}
        />
      </View>

      {status === 'error' ? (
        <ErrorState
          title="We couldn’t open your data"
          body="Check your connection and try again."
          onRetry={retry}
        />
      ) : (
        <View style={styles.body}>
          {status === 'ready' ? (
            <WebView
              ref={webview}
              testID="your-data-pdf"
              source={{ html }}
              originWhitelist={['*']}
              // Nothing loads in here but the viewer page itself.
              onShouldStartLoadWithRequest={(request) =>
                request.url.startsWith('about:') || request.url.startsWith('data:')
              }
              setSupportMultipleWindows={false}
              onMessage={onMessage}
              onError={() => setStatus('error')}
              style={styles.webview}
            />
          ) : null}
          {!shown ? (
            <View style={styles.loader}>
              <BrandLoader message="Putting your data together…" />
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
      flex: 1,
    },
    body: {
      flex: 1,
    },
    webview: {
      flex: 1,
      backgroundColor: c.background,
    },
    // Over the WebView until the pages are drawn, so it never flashes blank.
    loader: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
    },
  });

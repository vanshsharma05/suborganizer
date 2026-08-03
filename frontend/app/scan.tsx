import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { fmtMoney } from '@/src/currency';
import {
  applyCandidates,
  Candidate,
  connectGmail,
  disconnectGmail,
  EventKind,
  getGmailConnection,
  GmailAuthError,
  GmailConnection,
  gmailUnavailableReason,
  ScanCancelled,
  ScanDepth,
  scanGmail,
  ScanProgress,
  ScanResult,
} from '@/src/gmail';
import { CATEGORY_COLORS, theme } from '@/src/theme';
import { BrandAvatar } from '@/src/ui';
import { PRODUCTS } from '@/src/entitlements';
import { usePurchases } from '@/src/purchases';
import { UpgradeSheet } from '@/src/paywall';

type Phase = 'idle' | 'connecting' | 'scanning' | 'results' | 'importing';

const STAGE_COPY: Record<ScanProgress['stage'], string> = {
  searching: 'Searching your mailbox',
  reading: 'Reading subscription emails',
  details: 'Pulling amounts from receipts',
  resolving: 'Working out what is still active',
};

const EVENT_STYLE: Record<EventKind, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  start: { icon: 'play-circle', color: theme.color.success, label: 'Started' },
  charge: { icon: 'card', color: theme.color.brandPrimary, label: 'Charged' },
  cancel: { icon: 'close-circle', color: theme.color.error, label: 'Cancelled' },
  renewal_notice: { icon: 'alarm', color: theme.color.brandSecondary, label: 'Renewal notice' },
  payment_failed: { icon: 'warning', color: theme.color.warning, label: 'Payment failed' },
  price_change: { icon: 'trending-up', color: theme.color.gold, label: 'Price change' },
};

const CONFIDENCE_STYLE = {
  high: { bg: theme.color.successTint, fg: theme.color.success, label: 'Confident' },
  medium: { bg: theme.color.warningTint, fg: theme.color.warning, label: 'Likely' },
  low: { bg: theme.color.surfaceSecondary, fg: theme.color.inkMuted, label: 'Unsure' },
} as const;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, refreshSubs } = useAuth();
  const { canScan } = usePurchases();

  const unavailable = useMemo(() => gmailUnavailableReason(), []);
  const configured = unavailable === null;
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [depth, setDepth] = useState<ScanDepth>('quick');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUnsure, setShowUnsure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // Mutated rather than replaced so the running scan sees the change.
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    return () => {
      abortRef.current.cancelled = true;
    };
  }, []);

  // On focus, not just on mount: the OAuth redirect bounces through
  // /gmail-callback and back here, and the grant is written to storage during
  // that round trip.
  useFocusEffect(
    useCallback(() => {
      getGmailConnection()
        .then(setConnection)
        .catch(() => setConnection(null));
    }, []),
  );

  const connect = async () => {
    setError(null);
    setPhase('connecting');
    try {
      setConnection(await connectGmail());
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      const message = e instanceof Error ? e.message : 'Could not connect Gmail';
      // Backing out of the Google sheet is a choice, not a failure.
      if (!/cancelled/i.test(message)) setError(message);
    }
  };

  const forgetGmail = async () => {
    await disconnectGmail();
    setConnection(null);
    setResult(null);
    setPhase('idle');
  };

  /**
   * Asks first. The Account screen already did; this one did not, and this is
   * where it costs more — the button sits a thumb's width from Back, and a
   * mis-tap here throws away a scan that took two minutes to run along with the
   * grant needed to run another.
   */
  const disconnect = () => {
    Alert.alert(
      'Disconnect Gmail?',
      result
        ? 'This clears the results on screen, and you will have to grant access again before you can scan.'
        : 'You will have to grant access again before you can scan.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void forgetGmail() },
      ],
    );
  };

  const runScan = async () => {
    setError(null);
    setResult(null);
    setProgress(null);
    setPhase('scanning');
    abortRef.current = { cancelled: false };

    try {
      const scan = await scanGmail({
        depth,
        existing: subs,
        signal: abortRef.current,
        onProgress: setProgress,
      });

      setResult(scan);
      // Pre-tick what is worth acting on, leave the guesses to the user.
      setSelected(
        new Set(
          scan.candidates
            .filter((c) => (c.existingId ? Boolean(c.drift) : c.confidence !== 'low'))
            .map((c) => c.key),
        ),
      );
      setPhase('results');
    } catch (e) {
      setPhase('idle');
      if (e instanceof ScanCancelled) return;
      if (e instanceof GmailAuthError) {
        setConnection(null);
        setError(e.message);
        return;
      }
      setError(e instanceof Error ? e.message : 'The scan failed');
    }
  };

  /**
   * The gate, in one place.
   *
   * Connecting Gmail stays free, so the user grants access and sees the app is
   * real before being asked for anything. The charge sits on the scan itself,
   * which is the step that costs us API quota and the step whose value they can
   * already picture.
   */
  const startScan = () => {
    if (!canScan) {
      setUnlocking(true);
      return;
    }
    void runScan();
  };

  const cancelScan = () => {
    abortRef.current.cancelled = true;
    setPhase('idle');
  };

  const toggle = useCallback((key: string, set: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const actionable = useMemo(
    () => (result?.candidates ?? []).filter((c) => !c.existingId || c.drift),
    [result],
  );
  const chosen = useMemo(
    () => actionable.filter((c) => selected.has(c.key)),
    [actionable, selected],
  );

  const runImport = async () => {
    if (!chosen.length) return;
    setPhase('importing');

    try {
      const outcome = await applyCandidates(chosen);
      await refreshSubs();

      // Drop what landed, so a second tap cannot create a duplicate row. Anything
      // that failed stays on screen and stays ticked, ready to retry.
      const failed = new Set(outcome.failed);
      const applied = new Set(chosen.filter((c) => !failed.has(c.name)).map((c) => c.key));
      setResult((prev) =>
        prev ? { ...prev, candidates: prev.candidates.filter((c) => !applied.has(c.key)) } : prev,
      );
      setSelected((prev) => new Set([...prev].filter((k) => !applied.has(k))));

      const parts: string[] = [];
      if (outcome.imported) parts.push(`Added ${outcome.imported}`);
      if (outcome.reconciled) parts.push(`Updated ${outcome.reconciled}`);

      /*
       * Leaving is only offered when there is nothing left to do.
       *
       * The code above deliberately keeps failures on screen and ticked so they
       * can be retried — and then the alert's only button walked away from them.
       * A partial failure now keeps the user here, next to the rows that need
       * the second tap.
       */
      if (outcome.failed.length > 0) {
        const done = parts.length > 0 ? `${parts.join(' · ')}. ` : '';
        Alert.alert(
          parts.length > 0 ? 'Partly added' : 'Could not add these',
          `${done}Could not add: ${outcome.failed.join(', ')}. They are still ticked below — tap Add again to retry.`,
          [{ text: 'Stay here', style: 'cancel' }],
        );
      } else {
        Alert.alert('Gmail scan', parts.join(' · ') || 'Nothing to apply', [
          { text: 'Done', onPress: () => router.back() },
        ]);
      }
    } finally {
      // In `finally` so a failure anywhere above cannot strand the screen in
      // `importing`, where the Add button stays disabled with no way back.
      setPhase('results');
    }
  };

  // Low-confidence rows are kept but quarantined: they are guesses, and mixing
  // them into the main list is what makes a scan look like it invents things.
  const newFinds = actionable.filter((c) => !c.existingId && c.confidence !== 'low');
  const unsure = actionable.filter((c) => !c.existingId && c.confidence === 'low');
  const drifted = actionable.filter((c) => c.drift);
  const tracked = (result?.candidates ?? []).filter((c) => c.existingId && !c.drift);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} testID="scan-back">
          <Ionicons name="chevron-back" size={22} color={theme.color.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Scan Gmail</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            {connection?.email ?? 'Find subscriptions from your receipts'}
          </Text>
        </View>
        {connection && phase !== 'scanning' && (
          <Pressable onPress={disconnect} style={s.linkBtn} testID="scan-disconnect">
            <Text style={s.linkText}>Disconnect</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + (chosen.length ? 120 : 40) }}
        showsVerticalScrollIndicator={false}
        testID="scan-scroll"
      >
        {error && (
          <Animated.View entering={FadeIn} style={s.errorBox} testID="scan-error">
            <Ionicons name="alert-circle" size={18} color={theme.color.error} />
            <Text style={s.errorText}>{error}</Text>
          </Animated.View>
        )}

        {!configured && <NotConfigured reason={unavailable} />}

        {configured && !connection && phase !== 'connecting' && (
          <ConnectCard onConnect={connect} />
        )}

        {phase === 'connecting' && <Busy label="Waiting for Google…" />}

        {configured && connection && phase === 'idle' && (
          <ScanSetup
            depth={depth}
            onDepth={setDepth}
            onScan={startScan}
            lastScan={result?.scannedAt}
            locked={!canScan}
          />
        )}

        {phase === 'scanning' && <Progress progress={progress} onCancel={cancelScan} />}

        {(phase === 'results' || phase === 'importing') && result && (
          <>
            <Summary result={result} />

            {drifted.length > 0 && (
              <Section
                title="Changed since you added them"
                caption="Your mailbox says something different from what the app has."
              >
                {drifted.map((c, i) => (
                  <CandidateCard
                    key={c.key}
                    candidate={c}
                    index={i}
                    selected={selected.has(c.key)}
                    expanded={expanded.has(c.key)}
                    onToggle={() => toggle(c.key, setSelected)}
                    onExpand={() => toggle(c.key, setExpanded)}
                  />
                ))}
              </Section>
            )}

            {newFinds.length > 0 && (
              <Section
                title={`Found ${newFinds.length} subscription${newFinds.length === 1 ? '' : 's'}`}
                caption="Tap a card to see the emails behind it."
              >
                {newFinds.map((c, i) => (
                  <CandidateCard
                    key={c.key}
                    candidate={c}
                    index={i}
                    selected={selected.has(c.key)}
                    expanded={expanded.has(c.key)}
                    onToggle={() => toggle(c.key, setSelected)}
                    onExpand={() => toggle(c.key, setExpanded)}
                  />
                ))}
              </Section>
            )}

            {unsure.length > 0 && (
              <Section
                title={`Not sure about ${unsure.length}`}
                caption="Weaker evidence — check the emails before adding these."
              >
                {showUnsure ? (
                  unsure.map((c, i) => (
                    <CandidateCard
                      key={c.key}
                      candidate={c}
                      index={i}
                      selected={selected.has(c.key)}
                      expanded={expanded.has(c.key)}
                      onToggle={() => toggle(c.key, setSelected)}
                      onExpand={() => toggle(c.key, setExpanded)}
                    />
                  ))
                ) : (
                  <Pressable
                    onPress={() => setShowUnsure(true)}
                    style={s.revealBtn}
                    testID="scan-show-unsure"
                  >
                    <Ionicons name="eye-outline" size={16} color={theme.color.inkSoft} />
                    <Text style={s.rescanText}>Show {unsure.length} uncertain</Text>
                  </Pressable>
                )}
              </Section>
            )}

            {tracked.length > 0 && (
              <Section title="Already tracked" caption="Matched what you have — nothing to change.">
                <View style={s.trackedWrap}>
                  {tracked.map((c) => (
                    <View key={c.key} style={s.trackedChip}>
                      <Ionicons name="checkmark-circle" size={14} color={theme.color.success} />
                      <Text style={s.trackedText}>{c.name}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {actionable.length === 0 && (
              <View style={s.emptyBox}>
                <Ionicons name="sparkles-outline" size={26} color={theme.color.brandSecondary} />
                <Text style={s.emptyTitle}>Nothing new to add</Text>
                <Text style={s.emptyText}>
                  Everything the scan recognised is already in your list. Try a deep scan for older
                  receipts.
                </Text>
              </View>
            )}

            <Pressable onPress={startScan} style={s.rescanBtn} testID="scan-again">
              <Ionicons name="refresh" size={16} color={theme.color.inkSoft} />
              <Text style={s.rescanText}>Scan again</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {chosen.length > 0 && (phase === 'results' || phase === 'importing') && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
          <Pressable
            onPress={runImport}
            disabled={phase === 'importing'}
            style={({ pressed }) => [s.importBtn, pressed && { opacity: 0.9 }]}
            testID="scan-import"
          >
            <LinearGradient
              colors={theme.color.coralGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.importInner}
            >
              {phase === 'importing' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                  <Text style={s.importText}>
                    Apply {chosen.length} change{chosen.length === 1 ? '' : 's'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}

      <UpgradeSheet
        product={PRODUCTS.scan}
        visible={unlocking}
        onClose={() => setUnlocking(false)}
        // Straight into the scan they just paid for, rather than returning them
        // to the button they already pressed.
        onPurchased={() => void runScan()}
      />
    </View>
  );
}

// ------------------------------------------------------------------ pieces --

function NotConfigured({ reason }: { reason: string | null }) {
  return (
    <View style={s.card} testID="scan-not-configured">
      <Ionicons name="construct-outline" size={24} color={theme.color.brandSecondary} />
      <Text style={s.cardTitle}>Gmail scanning needs setup</Text>
      <Text style={s.cardText}>
        {reason ?? 'Gmail scanning cannot run here.'}
      </Text>
    </View>
  );
}

function ConnectCard({ onConnect }: { onConnect: () => void }) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={s.card} testID="scan-connect-card">
      <View style={s.iconCircle}>
        <Ionicons name="mail-open-outline" size={22} color={theme.color.brandPrimary} />
      </View>
      <Text style={s.cardTitle}>Connect Gmail</Text>
      <Text style={s.cardText}>
        We read receipts, welcome emails and cancellation notices to work out what you pay for —
        then replay them in order, so anything you cancelled shows as cancelled and anything you
        started again shows as active.
      </Text>

      <View style={s.bullets}>
        <Bullet icon="lock-closed-outline" text="Read-only access. Nothing is sent, deleted or changed." />
        <Bullet icon="phone-portrait-outline" text="Emails are read on your device and never stored." />
        <Bullet icon="hand-left-outline" text="Nothing is added to your list until you approve it." />
      </View>

      <Pressable onPress={onConnect} style={s.primaryBtn} testID="scan-connect">
        <LinearGradient
          colors={theme.color.coralGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.primaryInner}
        >
          <Ionicons name="logo-google" size={17} color="#FFFFFF" />
          <Text style={s.primaryText}>Connect Gmail</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function Bullet({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={s.bulletRow}>
      <Ionicons name={icon} size={15} color={theme.color.brandSecondary} />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

function ScanSetup({
  depth,
  onDepth,
  onScan,
  lastScan,
  locked,
}: {
  depth: ScanDepth;
  onDepth: (d: ScanDepth) => void;
  onScan: () => void;
  lastScan?: number;
  /** True until the scan has been paid for. Changes the label, not the flow. */
  locked: boolean;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={s.card} testID="scan-setup">
      <Text style={s.cardTitle}>How far back?</Text>
      <View style={s.depthRow}>
        <DepthOption
          active={depth === 'quick'}
          onPress={() => onDepth('quick')}
          title="Quick"
          detail="Last 15 months · ~300 emails"
        />
        <DepthOption
          active={depth === 'deep'}
          onPress={() => onDepth('deep')}
          title="Deep"
          detail="Last 3 years · ~800 emails"
        />
      </View>
      <Text style={s.cardHint}>
        A deep scan catches yearly plans and older cancellations, but takes longer.
      </Text>

      {lastScan && (
        <Text style={s.cardHint}>Last scan {format(new Date(lastScan), 'd MMM, HH:mm')}</Text>
      )}

      <Pressable onPress={onScan} style={s.primaryBtn} testID="scan-start">
        <LinearGradient
          colors={theme.color.coralGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.primaryInner}
        >
          <Ionicons name={locked ? 'lock-closed' : 'search'} size={17} color="#FFFFFF" />
          {/* No price on the button. The store owns that number, and this label
              renders long before the store has answered. */}
          <Text style={s.primaryText}>{locked ? 'Unlock the scan' : 'Start scan'}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function DepthOption({
  active,
  onPress,
  title,
  detail,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  detail: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.depthOption, active && s.depthOptionActive]}
      testID={`scan-depth-${title.toLowerCase()}`}
    >
      <Text style={[s.depthTitle, active && { color: '#FFFFFF' }]}>{title}</Text>
      <Text style={[s.depthDetail, active && { color: 'rgba(255,255,255,0.75)' }]}>{detail}</Text>
    </Pressable>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <View style={s.card}>
      <ActivityIndicator color={theme.color.brandPrimary} />
      <Text style={s.cardText}>{label}</Text>
    </View>
  );
}

function Progress({ progress, onCancel }: { progress: ScanProgress | null; onCancel: () => void }) {
  const pct = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;

  return (
    <View style={s.card} testID="scan-progress">
      <ActivityIndicator color={theme.color.brandPrimary} />
      <Text style={s.cardTitle}>{progress ? STAGE_COPY[progress.stage] : 'Starting…'}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      {progress && (
        <Text style={s.cardHint}>
          {progress.done} of {progress.total}
        </Text>
      )}
      <Pressable onPress={onCancel} style={s.linkBtn} testID="scan-cancel">
        <Text style={s.linkText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Summary({ result }: { result: ScanResult }) {
  const cancelled = result.candidates.filter((c) => c.status === 'cancelled').length;
  const restarted = result.candidates.filter((c) => c.resubscribed).length;

  return (
    <View style={s.summaryRow} testID="scan-summary">
      <SummaryTile value={String(result.messagesScanned)} label="emails read" />
      <SummaryTile value={String(result.candidates.length)} label="services seen" />
      <SummaryTile value={String(cancelled)} label="cancelled" />
      <SummaryTile value={String(restarted)} label="restarted" />
    </View>
  );
}

function SummaryTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.summaryTile}>
      <Text style={s.summaryValue}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {caption && <Text style={s.sectionCaption}>{caption}</Text>}
      {children}
    </View>
  );
}

const DRIFT_COPY: Record<NonNullable<Candidate['drift']>, string> = {
  'cancelled-in-gmail': 'Cancelled in Gmail — still active here',
  'active-again': 'Started again in Gmail — marked cancelled here',
  'amount-changed': 'The amount you pay has changed',
};

function CandidateCard({
  candidate,
  index,
  selected,
  expanded,
  onToggle,
  onExpand,
}: {
  candidate: Candidate;
  index: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const conf = CONFIDENCE_STYLE[candidate.confidence];
  const categoryColor = CATEGORY_COLORS[candidate.category] ?? theme.color.brand;

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(360)}>
      <View style={[s.candidate, selected && s.candidateSelected]} testID={`scan-card-${candidate.name}`}>
        <View style={s.candidateTop}>
          <Pressable onPress={onToggle} hitSlop={8} testID={`scan-toggle-${candidate.name}`}>
            <View style={[s.checkbox, selected && s.checkboxOn]}>
              {selected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </View>
          </Pressable>

          <BrandAvatar sub={{ name: candidate.name, domain: candidate.domain ?? null }} size={40} />

          <Pressable style={{ flex: 1 }} onPress={onExpand} testID={`scan-expand-${candidate.name}`}>
            <View style={s.nameRow}>
              <Text style={s.candidateName} numberOfLines={1}>
                {candidate.name}
              </Text>
              <View style={[s.badge, { backgroundColor: conf.bg }]}>
                <Text style={[s.badgeText, { color: conf.fg }]}>{conf.label}</Text>
              </View>
            </View>

            <Text style={s.candidateMeta} numberOfLines={1}>
              {candidate.amount !== undefined
                ? `${fmtMoney(candidate.amount, candidate.currency)} · ${candidate.billing_cycle}`
                : `Amount unknown · ${candidate.billing_cycle}`}
              {' · '}
              <Text style={{ color: categoryColor }}>{candidate.category}</Text>
            </Text>
          </Pressable>

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.color.inkMuted}
          />
        </View>

        <View style={s.flagRow}>
          {candidate.status === 'cancelled' ? (
            <Flag color={theme.color.error} icon="close-circle" text="Cancelled" />
          ) : (
            <Flag
              color={theme.color.success}
              icon="checkmark-circle"
              text={`Active · renews ${format(new Date(candidate.next_renewal), 'd MMM')}`}
            />
          )}
          {candidate.resubscribed && (
            <Flag color={theme.color.brandSecondary} icon="repeat" text="Started again" />
          )}
          {candidate.dormant && (
            <Flag color={theme.color.warning} icon="moon" text="No recent charge" />
          )}
          {candidate.lastPaymentFailed && (
            <Flag color={theme.color.warning} icon="warning" text="Payment failed" />
          )}
          {candidate.drift && (
            <Flag color={theme.color.brandPrimary} icon="git-compare" text={DRIFT_COPY[candidate.drift]} />
          )}
        </View>

        {expanded && (
          <Animated.View entering={FadeIn.duration(200)} style={s.expandBox}>
            {candidate.reasons.length > 0 && (
              <View style={s.reasonBox}>
                {candidate.reasons.map((r) => (
                  <Text key={r} style={s.reasonText}>
                    • {r}
                  </Text>
                ))}
              </View>
            )}

            <Text style={s.timelineHeading}>
              {candidate.events.length} email{candidate.events.length === 1 ? '' : 's'}
            </Text>

            {candidate.events.slice(0, 12).map((e) => {
              const style = EVENT_STYLE[e.kind];
              return (
                <View key={e.messageId} style={s.eventRow}>
                  <Ionicons name={style.icon} size={15} color={style.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.eventSubject} numberOfLines={2}>
                      {e.subject || '(no subject)'}
                    </Text>
                    <Text style={s.eventMeta}>
                      {style.label} · {format(new Date(e.date), 'd MMM yyyy')} · matched “{e.label}”
                      {e.money ? ` · ${fmtMoney(e.money.amount, e.money.currency)}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}

            {candidate.events.length > 12 && (
              <Text style={s.eventMeta}>+ {candidate.events.length - 12} more</Text>
            )}
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

function Flag({
  color,
  icon,
  text,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={[s.flag, { backgroundColor: color + '15', borderColor: color + '35' }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[s.flagText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ styles --

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: theme.color.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.color.inkSoft, fontSize: 12, marginTop: 1 },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  linkText: { color: theme.color.brandSecondary, fontSize: 13, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.errorTint,
  },
  errorText: { flex: 1, color: theme.color.error, fontSize: 12.5, lineHeight: 18 },
  card: {
    ...theme.shadow.sm,
    marginHorizontal: 20,
    padding: 22,
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: theme.color.ink,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  cardText: {
    color: theme.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  cardHint: { color: theme.color.inkMuted, fontSize: 11.5, textAlign: 'center' },
  bullets: { alignSelf: 'stretch', gap: 10, marginTop: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletText: { flex: 1, color: theme.color.inkSoft, fontSize: 12.5, lineHeight: 18 },
  primaryBtn: { alignSelf: 'stretch', borderRadius: theme.radius.pill, overflow: 'hidden', marginTop: 6 },
  primaryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 52,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  depthRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  depthOption: {
    ...theme.shadow.sm,
    flex: 1,
    padding: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    gap: 3,
  },
  depthOptionActive: { backgroundColor: theme.color.ink, borderColor: theme.color.ink },
  depthTitle: { color: theme.color.ink, fontSize: 14, fontWeight: '700' },
  depthDetail: { color: theme.color.inkMuted, fontSize: 11 },
  barTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.surfaceSecondary,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: theme.color.brandPrimary },
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 4 },
  summaryTile: {
    ...theme.shadow.sm,
    flex: 1,
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryValue: { color: theme.color.ink, fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel: { color: theme.color.inkMuted, fontSize: 9.5, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  section: { marginTop: 24, gap: 10 },
  sectionTitle: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
    paddingHorizontal: 20,
  },
  sectionCaption: {
    color: theme.color.inkSoft,
    fontSize: 12,
    paddingHorizontal: 20,
    marginTop: -6,
  },
  candidate: {
    marginHorizontal: 20,
    padding: 14,
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg,
    gap: 10,
    // Transparent rather than absent, so ticking a row changes the colour
    // without changing the size — a border appearing on selection shifts every
    // row below it by two pixels.
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...theme.shadow.sm,
  },
  candidateSelected: { borderColor: theme.color.brandPrimary, backgroundColor: '#FFFCFA' },
  candidateTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: theme.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  candidateName: { color: theme.color.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  candidateMeta: { color: theme.color.inkSoft, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  flagText: { fontSize: 10.5, fontWeight: '700', flexShrink: 1 },
  expandBox: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: 12,
    gap: 10,
  },
  reasonBox: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: 11,
    gap: 3,
  },
  reasonText: { color: theme.color.inkSoft, fontSize: 11.5, lineHeight: 17 },
  timelineHeading: {
    color: theme.color.inkMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  eventSubject: { color: theme.color.ink, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  eventMeta: { color: theme.color.inkMuted, fontSize: 10.5, marginTop: 1 },
  trackedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  trackedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.raised,
  },
  trackedText: { color: theme.color.inkSoft, fontSize: 12, fontWeight: '600' },
  emptyBox: { alignItems: 'center', gap: 8, paddingHorizontal: 40, paddingVertical: 32 },
  emptyTitle: { color: theme.color.ink, fontSize: 15, fontWeight: '700' },
  emptyText: { color: theme.color.inkSoft, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 26,
    paddingVertical: 12,
  },
  rescanText: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '600' },
  revealBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginHorizontal: 20, paddingVertical: 13, borderRadius: theme.radius.md,
     borderStyle: 'dashed',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(253,251,247,0.96)',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  importBtn: { borderRadius: theme.radius.pill, overflow: 'hidden' },
  importInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 54,
  },
  importText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});

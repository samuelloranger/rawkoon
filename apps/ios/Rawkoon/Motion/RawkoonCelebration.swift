import SwiftUI

enum CelebrationRing {
    case circle
    case roundedRect(cornerRadius: CGFloat)
}

/// Decides whether one trigger change earns a celebration.
nonisolated enum CelebrationGate {
    /// A real change that passes `predicate`; with no predicate every change counts.
    static func fires<T: Equatable>(from old: T, to new: T, when predicate: ((T, T) -> Bool)?) -> Bool {
        old != new && (predicate?(old, new) ?? true)
    }
}

extension View {
    /// A success moment: the view pops, a ring pulses out, and a haptic fires when `trigger` changes.
    /// Pass `when` to celebrate only some changes, e.g. `{ !$0 && $1 }` for false → true only.
    func rawkoonCelebrate<Trigger: Equatable>(
        trigger: Trigger,
        ring: CelebrationRing = .circle,
        tint: Color = Theme.seed,
        haptic: RawkoonHaptics.Event? = .success,
        when predicate: ((Trigger, Trigger) -> Bool)? = nil
    ) -> some View {
        modifier(Celebration(trigger: trigger, ring: ring, tint: tint, haptic: haptic, predicate: predicate))
    }
}

private struct CelebrationFrame {
    var contentScale: CGFloat = 1
    var ringScale: CGFloat = 1
    var ringOpacity: Double = 0
}

private struct Celebration<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let ring: CelebrationRing
    let tint: Color
    let haptic: RawkoonHaptics.Event?
    let predicate: ((Trigger, Trigger) -> Bool)?
    /// Counts accepted trigger changes; the animator and the haptic key off this, not the raw trigger.
    @State private var fires = 0

    func body(content: Content) -> some View {
        // Copied out so the nonisolated animator closures read no MainActor state.
        let showRing = !reduceMotion
        let tint = tint
        let isCircle = ringIsCircle
        let cornerRadius = ringCornerRadius
        let start = ringStart
        let end = ringEnd
        let haptic = haptic
        return content
            .keyframeAnimator(initialValue: CelebrationFrame(), trigger: fires) { view, frame in
                view
                    .scaleEffect(showRing ? frame.contentScale : 1)
                    .overlay {
                        if showRing {
                            Group {
                                if isCircle {
                                    Circle().strokeBorder(tint, lineWidth: 2)
                                } else {
                                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                                        .strokeBorder(tint, lineWidth: 2)
                                }
                            }
                            .scaleEffect(frame.ringScale)
                            .opacity(frame.ringOpacity)
                            .allowsHitTesting(false)
                        }
                    }
            } keyframes: { _ in
                KeyframeTrack(\.contentScale) {
                    SpringKeyframe(1.06, duration: 0.14)
                    SpringKeyframe(1, duration: 0.3)
                }
                KeyframeTrack(\.ringScale) {
                    LinearKeyframe(start, duration: 0.01)
                    CubicKeyframe(end, duration: 0.42)
                }
                KeyframeTrack(\.ringOpacity) {
                    LinearKeyframe(0.9, duration: 0.01)
                    CubicKeyframe(0, duration: 0.42)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: haptic ?? .success), trigger: fires) { _, _ in
                haptic != nil
            }
            .onChange(of: trigger) { old, new in
                if CelebrationGate.fires(from: old, to: new, when: predicate) {
                    fires += 1
                }
            }
    }

    private var ringIsCircle: Bool {
        if case .circle = ring {
            true
        } else {
            false
        }
    }

    private var ringCornerRadius: CGFloat {
        if case let .roundedRect(cornerRadius) = ring {
            cornerRadius
        } else {
            0
        }
    }

    /// A row's ring hugs its edge and grows a little; an icon's starts small and grows a lot.
    private var ringStart: CGFloat {
        if case .circle = ring {
            0.6
        } else {
            1
        }
    }

    private var ringEnd: CGFloat {
        if case .circle = ring {
            1.7
        } else {
            1.06
        }
    }
}

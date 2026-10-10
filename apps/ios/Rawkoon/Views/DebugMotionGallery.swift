#if DEBUG
    import SwiftUI

    /// Debug-only gallery that cycles every motion-kit piece on a timer, for simulator screenshots.
    struct DebugMotionGallery: View {
        @State private var tick = 0
        @State private var listIds = Array(0 ..< 12)
        @State private var showContent = false
        @State private var showBanner = false
        @State private var progress = 0.1
        private let emptyTitle = "Nothing here"
        private let errorTitle = "Failed"

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    LinearGradient(colors: [Theme.terracottaDeep, Theme.apricot], startPoint: .top, endPoint: .bottom)
                        .frame(height: 200)
                        .rawkoonStretchyHero(height: 200)

                    ZStack {
                        if showBanner {
                            Text(verbatim: "Reveal banner")
                                .padding(12)
                                .frame(maxWidth: .infinity)
                                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                                .transition(.rawkoonReveal)
                        }
                    }
                    .frame(minHeight: 48)
                    .rawkoonMotion(RawkoonMotion.spring, value: showBanner)

                    ZStack {
                        if showContent {
                            Text(verbatim: "Loaded content")
                                .font(.title3.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                                .transition(.rawkoonSwap)
                        } else {
                            ShimmerView(cornerRadius: 12).frame(height: 60)
                                .transition(.rawkoonSwap)
                        }
                    }
                    .rawkoonMotion(RawkoonMotion.spring, value: showContent)

                    HStack {
                        Text(verbatim: "\(Int(progress * 100))%")
                            .font(.system(.title2, design: .monospaced))
                            .rawkoonNumeric(progress)
                        DuskProgress(value: progress, isActive: true)
                    }

                    Image(systemName: "checkmark.circle.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Theme.seed)
                        .rawkoonCelebrate(trigger: tick)

                    Button {} label: {
                        Text(verbatim: "Press me")
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.rawkoonPressable)

                    ContentUnavailableView(emptyTitle, systemImage: "tray")
                        .rawkoonLivingSymbol(.empty)
                    ContentUnavailableView(errorTitle, systemImage: "exclamationmark.triangle")
                        .rawkoonLivingSymbol(.error)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))], spacing: 12) {
                        ForEach(listIds, id: \.self) { id in
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Theme.raised)
                                .frame(height: 120)
                                .overlay(Text(verbatim: "\(id)"))
                                .rawkoonEntrance(id: id)
                        }
                    }
                    .rawkoonEntranceScope()
                }
                .padding(16)
            }
            .background(Theme.base)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1.5))
                    tick += 1
                    showContent.toggle()
                    showBanner.toggle()
                    progress = progress >= 0.95 ? 0.1 : progress + 0.17
                    // New ids enter; existing ids must not replay.
                    if tick.isMultiple(of: 4) {
                        listIds.append(listIds.count)
                    }
                }
            }
        }
    }
#endif

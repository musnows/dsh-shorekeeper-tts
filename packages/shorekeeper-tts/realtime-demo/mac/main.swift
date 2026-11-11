import Cocoa
import WebKit
import AVFoundation
import AudioToolbox

final class PcmSpeaker {
    var queue: AudioQueueRef?
    var sampleRate: Double = 0

    func prepare(_ rate: Double) {
        if queue != nil, sampleRate == rate { return }
        if let queue {
            AudioQueueStop(queue, true)
            AudioQueueDispose(queue, true)
            self.queue = nil
        }
        var format = AudioStreamBasicDescription(
            mSampleRate: rate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2,
            mFramesPerPacket: 1,
            mBytesPerFrame: 2,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 16,
            mReserved: 0
        )
        var created: AudioQueueRef?
        let made = AudioQueueNewOutput(&format, { _, queue, buffer in
            AudioQueueFreeBuffer(queue, buffer)
        }, nil, nil, nil, 0, &created)
        guard made == noErr, let created else { return }
        AudioQueueSetParameter(created, kAudioQueueParam_Volume, 1)
        guard AudioQueueStart(created, nil) == noErr else {
            AudioQueueDispose(created, true)
            return
        }
        queue = created
        sampleRate = rate
    }

    func enqueue(base64: String, sampleRate: Double) {
        prepare(sampleRate)
        guard let queue, let data = Data(base64Encoded: base64), !data.isEmpty else { return }
        var buffer: AudioQueueBufferRef?
        guard AudioQueueAllocateBuffer(queue, UInt32(data.count), &buffer) == noErr, let buffer else { return }
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            buffer.pointee.mAudioData.copyMemory(from: base, byteCount: data.count)
        }
        buffer.pointee.mAudioDataByteSize = UInt32(data.count)
        AudioQueueEnqueueBuffer(queue, buffer, 0, nil)
    }

    func stop() {
        guard let queue else { return }
        AudioQueueStop(queue, true)
        AudioQueueStart(queue, nil)
    }
}

final class PetApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate {
    let window: NSPanel
    let web: WKWebView
    let speaker = PcmSpeaker()
    private var dragOffset: NSPoint?
    private var dragTimer: Timer?

    override init() {
        let size = NSSize(width: 208, height: 288)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let frame = NSRect(
            x: screen.maxX - size.width - 28,
            y: screen.minY + 36,
            width: size.width,
            height: size.height
        )
        window = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(UnsafeSendableBox.shared, name: "pet")
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        super.init()
        UnsafeSendableBox.shared.owner = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            web.underPageBackgroundColor = .clear
        }
        window.isFloatingPanel = true
        window.level = .floating
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.hidesOnDeactivate = false
        window.animationBehavior = .none
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        prepareMicrophone()
    }

    private func loadPet() {
        let port = ProcessInfo.processInfo.environment["PET_PORT"] ?? "18766"
        if let url = URL(string: "http://127.0.0.1:\(port)/pet") {
            web.load(URLRequest(url: url))
        }
    }

    private func prepareMicrophone() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            loadPet()
        case .notDetermined:
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                DispatchQueue.main.async {
                    NSApp.setActivationPolicy(.accessory)
                    self.loadPet()
                }
            }
        default:
            loadPet()
        }
    }

    private func stopDrag(redisplay: Bool = false) {
        dragTimer?.invalidate()
        dragTimer = nil
        if redisplay {
            window.setFrame(window.frame, display: true)
        }
        dragOffset = nil
    }

    private func clampToScreens(_ frame: NSRect) -> NSRect {
        let screens = NSScreen.screens
        guard !screens.isEmpty else { return frame }
        if screens.contains(where: { $0.frame.intersects(frame) }) {
            return frame
        }
        let target = NSScreen.main?.visibleFrame ?? screens[0].visibleFrame
        var next = frame
        next.origin.x = min(max(next.origin.x, target.minX), max(target.minX, target.maxX - next.width))
        next.origin.y = min(max(next.origin.y, target.minY), max(target.minY, target.maxY - next.height))
        return next
    }

    private func moveWindowToMouse(display: Bool) {
        guard let dragOffset else { return }
        let mouse = NSEvent.mouseLocation
        var frame = window.frame
        frame.origin = NSPoint(x: mouse.x - dragOffset.x, y: mouse.y - dragOffset.y)
        frame = clampToScreens(frame)
        /* display:false while dragging avoids flicker on multi-GPU / multi-monitor. */
        window.setFrame(frame, display: display)
    }

    private func beginNativeDrag() {
        stopDrag()
        let mouse = NSEvent.mouseLocation
        let frame = window.frame
        dragOffset = NSPoint(x: mouse.x - frame.origin.x, y: mouse.y - frame.origin.y)
        /* Poll Cocoa mouse location while the button stays down. This keeps
           working across displays without Accessibility permission, and does
           not depend on WKWebView pointermove surviving the screen edge. */
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            if NSEvent.pressedMouseButtons & 1 == 0 {
                self.moveWindowToMouse(display: true)
                self.stopDrag()
                return
            }
            self.moveWindowToMouse(display: false)
        }
        RunLoop.main.add(timer, forMode: .common)
        dragTimer = timer
        moveWindowToMouse(display: false)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pet",
              let body = message.body as? [String: Any] else { return }
        if (body["kind"] as? String) == "close" {
            stopDrag(redisplay: false)
            NSApp.terminate(nil)
            return
        }
        if (body["kind"] as? String) == "audio" {
            let pcm = body["pcm"] as? String ?? ""
            let rate = (body["rate"] as? NSNumber)?.doubleValue ?? 24000
            speaker.enqueue(base64: pcm, sampleRate: rate)
            return
        }
        if (body["kind"] as? String) == "stop-audio" {
            speaker.stop()
            return
        }
        if (body["kind"] as? String) == "drag-start" {
            beginNativeDrag()
            return
        }
        if (body["kind"] as? String) == "drag-end" {
            moveWindowToMouse(display: true)
            stopDrag(redisplay: true)
            return
        }
        /* Legacy delta moves are ignored: screenX deltas break across displays. */
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}

final class UnsafeSendableBox: NSObject, WKScriptMessageHandler {
    static let shared = UnsafeSendableBox()
    weak var owner: PetApp?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.userContentController(controller, didReceive: message)
    }
}

let app = NSApplication.shared
let delegate = PetApp()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

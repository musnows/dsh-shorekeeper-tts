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

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pet",
              let body = message.body as? [String: Any] else { return }
        if (body["kind"] as? String) == "close" {
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
        guard (body["kind"] as? String) == "move" else { return }
        let dx = (body["dx"] as? NSNumber)?.doubleValue ?? 0
        let dy = (body["dy"] as? NSNumber)?.doubleValue ?? 0
        var frame = window.frame
        frame.origin.x += dx
        frame.origin.y -= dy
        window.setFrame(frame, display: true)
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

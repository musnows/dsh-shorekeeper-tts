import AppKit

let monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    let blocked: NSEvent.ModifierFlags = [.command, .shift]
    let controlOption = flags.contains(.control) && flags.contains(.option)
    if controlOption && flags.intersection(blocked).isEmpty && event.charactersIgnoringModifiers == "." {
        print("stop")
        fflush(stdout)
    }
}

if monitor == nil {
    fputs("dsh-shorekeeper-stop-hotkey: accessibility permission is required\n", stderr)
}

RunLoop.main.run()

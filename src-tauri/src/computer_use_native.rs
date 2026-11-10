//! Skutečná plocha pro `computer_use`: okna a snímky přes xcap, myš a klávesnice přes enigo.
//! Enigo a okna xcap se vytvářejí pro každé volání, nejsou Send a držet je mezi vlákny nejde.

use crate::computer_use::{Desktop, MouseButton, WindowInfo};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use std::thread::sleep;
use std::time::Duration;
use xcap::image::{codecs::jpeg::JpegEncoder, imageops, DynamicImage};
use xcap::Window;

const JPEG_QUALITY: u8 = 80;
/// Aplikace potřebují chvíli na zpracování pohybu před kliknutím, jinak klik padne na staré místo.
const SETTLE: Duration = Duration::from_millis(60);
const TYPE_PAUSE: Duration = Duration::from_millis(15);

pub struct NativeDesktop;

fn enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("Ovládání myši a klávesnice nejde spustit (macOS potřebuje povolení Zpřístupnění): {e}"))
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn info(w: &Window) -> Option<WindowInfo> {
    Some(WindowInfo {
        id: w.id().ok()?,
        app: w.app_name().ok()?,
        title: w.title().unwrap_or_default(),
        x: w.x().ok()?,
        y: w.y().ok()?,
        width: w.width().ok()?,
        height: w.height().ok()?,
        focused: w.is_focused().unwrap_or(false),
        minimized: w.is_minimized().unwrap_or(false),
    })
}

/// Rozměr snímku: delší strana nejvýš `max_edge`, poměr stran zůstává.
pub fn scaled(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_edge {
        return (width, height);
    }
    let ratio = max_edge as f64 / longest as f64;
    (((width as f64 * ratio).round() as u32).max(1), ((height as f64 * ratio).round() as u32).max(1))
}

fn key_of(name: &str) -> Result<Key, String> {
    Ok(match name {
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "cmd" | "command" => Key::Meta,
        "enter" | "return" => Key::Return,
        "esc" | "escape" => Key::Escape,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1, "f2" => Key::F2, "f3" => Key::F3, "f4" => Key::F4, "f5" => Key::F5, "f6" => Key::F6,
        "f7" => Key::F7, "f8" => Key::F8, "f9" => Key::F9, "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        other => {
            let mut chars = other.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return Err(format!("Neznámá klávesa {other}.")),
            }
        }
    })
}

impl Desktop for NativeDesktop {
    fn windows(&self) -> Result<Vec<WindowInfo>, String> {
        Ok(Window::all().map_err(err)?.iter().filter_map(info).collect())
    }

    fn capture(&self, window: &WindowInfo, max_edge: u32) -> Result<(Vec<u8>, u32, u32), String> {
        let target = Window::all().map_err(err)?.into_iter().find(|w| w.id().ok() == Some(window.id)).ok_or("Okno už neexistuje.")?;
        let image = target.capture_image().map_err(err)?;
        let (w, h) = scaled(image.width(), image.height(), max_edge);
        let resized = if (w, h) == (image.width(), image.height()) { image } else { imageops::resize(&image, w, h, imageops::FilterType::Triangle) };
        let rgb = DynamicImage::ImageRgba8(resized).to_rgb8();
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY).encode_image(&rgb).map_err(err)?;
        Ok((jpeg, w, h))
    }

    fn focus(&self, window: &WindowInfo) -> Result<(), String> {
        platform::focus(window)?;
        sleep(Duration::from_millis(150));
        Ok(())
    }

    fn click(&self, x: i32, y: i32, button: MouseButton, count: u32) -> Result<(), String> {
        let mut e = enigo()?;
        e.move_mouse(x, y, Coordinate::Abs).map_err(err)?;
        sleep(SETTLE);
        let b = match button {
            MouseButton::Left => Button::Left,
            MouseButton::Right => Button::Right,
            MouseButton::Middle => Button::Middle,
        };
        for _ in 0..count {
            e.button(b, Direction::Click).map_err(err)?;
            sleep(Duration::from_millis(40));
        }
        Ok(())
    }

    fn type_text(&self, text: &str) -> Result<(), String> {
        // Po znacích s pauzou: aplikace, které fokus přesměrují až po prvním znaku, jinak znaky přeházejí
        // (LibreCAD dostal "inel" místo "line")
        let mut e = enigo()?;
        let mut buf = [0u8; 4];
        for c in text.chars() {
            e.text(c.encode_utf8(&mut buf)).map_err(err)?;
            sleep(TYPE_PAUSE);
        }
        Ok(())
    }

    fn key(&self, combo: &[String]) -> Result<(), String> {
        let keys = combo.iter().map(|k| key_of(k)).collect::<Result<Vec<_>, _>>()?;
        let (last, modifiers) = keys.split_last().ok_or("Prázdná zkratka.")?;
        let mut e = enigo()?;
        for m in modifiers {
            e.key(*m, Direction::Press).map_err(err)?;
        }
        let result = e.key(*last, Direction::Click).map_err(err);
        // modifikátory pustit vždy, jinak by zůstaly uživateli stisknuté
        for m in modifiers.iter().rev() {
            let _ = e.key(*m, Direction::Release);
        }
        result
    }

    fn scroll(&self, x: i32, y: i32, dx: i32, dy: i32) -> Result<(), String> {
        let mut e = enigo()?;
        e.move_mouse(x, y, Coordinate::Abs).map_err(err)?;
        sleep(SETTLE);
        if dy != 0 {
            e.scroll(dy, Axis::Vertical).map_err(err)?;
        }
        if dx != 0 {
            e.scroll(dx, Axis::Horizontal).map_err(err)?;
        }
        Ok(())
    }

    fn pointer(&self) -> Result<(i32, i32), String> {
        enigo()?.location().map_err(err)
    }

    fn point_in_app(&self, window: &WindowInfo, x: i32, y: i32) -> Option<bool> {
        platform::point_in_app(window, x, y)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::WindowInfo;
    pub fn focus(window: &WindowInfo) -> Result<(), String> {
        let name = window.app.replace(['"', '\\'], "");
        let status = std::process::Command::new("osascript").args(["-e", &format!("tell application \"{name}\" to activate")]).status().map_err(|e| e.to_string())?;
        if status.success() { Ok(()) } else { Err(format!("Aplikaci {name} nejde aktivovat.")) }
    }
    pub fn point_in_app(_window: &WindowInfo, _x: i32, _y: i32) -> Option<bool> {
        None
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::WindowInfo;
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY};
    use windows::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow, WindowFromPoint, SW_RESTORE};

    /// Stejný proces, ne stejné okno: rozbalená nabídka a dialog aplikace jsou samostatná okna.
    pub fn point_in_app(window: &WindowInfo, x: i32, y: i32) -> Option<bool> {
        unsafe {
            let target = HWND(window.id as usize as *mut core::ffi::c_void);
            let at = WindowFromPoint(POINT { x, y });
            if at.0.is_null() {
                return Some(false);
            }
            let (mut target_pid, mut at_pid) = (0u32, 0u32);
            GetWindowThreadProcessId(target, Some(&mut target_pid));
            GetWindowThreadProcessId(at, Some(&mut at_pid));
            Some(target_pid != 0 && target_pid == at_pid)
        }
    }

    fn empty_key(flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
    }

    /// Windows nedovolí procesu na pozadí vzít popředí. Prázdná klávesová událost mu to právo dá
    /// (na rozdíl od klávesy Alt neotevře v cílové aplikaci nabídku) a připojení k vláknu aktuálního
    /// okna pokryje zbytek. Povede-li se to, ověřuje jádro přes `focused`, jinak se vstup nepošle.
    pub fn focus(window: &WindowInfo) -> Result<(), String> {
        let hwnd = HWND(window.id as usize as *mut core::ffi::c_void);
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let foreground = GetForegroundWindow();
            let current = GetCurrentThreadId();
            let other = if foreground.0.is_null() { 0 } else { GetWindowThreadProcessId(foreground, None) };
            let attached = other != 0 && other != current && AttachThreadInput(current, other, true).as_bool();
            SendInput(&[empty_key(KEYBD_EVENT_FLAGS(0)), empty_key(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32);
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            if attached {
                let _ = AttachThreadInput(current, other, false);
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::WindowInfo;
    pub fn point_in_app(_window: &WindowInfo, _x: i32, _y: i32) -> Option<bool> {
        None
    }
    pub fn focus(_window: &WindowInfo) -> Result<(), String> {
        Err("Ovládání aplikací je podporované jen na Windows a macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaling_keeps_ratio_and_never_enlarges() {
        assert_eq!(scaled(800, 600, 1568), (800, 600));
        assert_eq!(scaled(3136, 1568, 1568), (1568, 784));
        assert_eq!(scaled(1000, 4000, 1568), (392, 1568));
    }

    /// Jen čte seznam oken: nic nesnímá, neklikne ani nenapíše.
    #[test]
    #[ignore]
    fn real_desktop_lists_windows() {
        let windows = NativeDesktop.windows().unwrap();
        println!("oken: {}, aplikací: {}", windows.len(), windows.iter().map(|w| w.app.as_str()).collect::<std::collections::HashSet<_>>().len());
        assert!(!windows.is_empty());
    }

    /// Skutečná plocha Windows v interaktivní session: otevře Poznámkový blok a ovládá ho přes jádro.
    /// Výsledky a snímek zapisuje do STAVEBAK_WIN_OUT. Spouštět jen na testovacím stroji.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn real_windows_notepad_roundtrip() {
        use crate::computer_use::{ComputerUse, Consent, Output, GRANT_TTL};
        use serde_json::json;
        use std::sync::Arc;

        struct Yes;
        impl Consent for Yes {
            fn ask(&self, _a: &[String], _r: &[String], _t: &str) -> bool { true }
        }

        // Aplikace běží jako DPI-aware (Tauri), test se musí chovat stejně
        let _ = enigo::set_dpi_awareness();
        let out = std::path::PathBuf::from(std::env::var("STAVEBAK_WIN_OUT").unwrap());
        let file = out.join("poznamky.txt");
        std::fs::write(&file, "").unwrap();
        let mut child = std::process::Command::new("notepad.exe").arg(&file).spawn().unwrap();
        sleep(Duration::from_secs(4));

        let desktop = Arc::new(NativeDesktop);
        let all = desktop.windows().unwrap();
        for w in &all { println!("okno: {} | {} | {},{} {}x{} focus={}", w.app, w.title, w.x, w.y, w.width, w.height, w.focused); }
        let app = all.iter().find(|w| w.title.to_lowercase().contains("poznamky")).expect("okno Poznámkového bloku").app.clone();
        println!("název aplikace: {app}");

        let cu = ComputerUse::new(desktop.clone(), Arc::new(Yes), GRANT_TTL, Box::new(|a, d| println!("log {a} {d}")));
        assert!(matches!(cu.call("computer_request_access", &json!({ "apps": [app], "reason": "test" })), Output::Text(_)));
        match cu.call("computer_screenshot", &json!({ "app": app })) {
            Output::Image { jpeg, caption } => { std::fs::write(out.join("pred.jpg"), jpeg).unwrap(); println!("{caption}"); }
            o => panic!("snímek: {o:?}"),
        }

        // Klik doprostřed okna: ukazatel musí skončit tam, kam jádro počítá (škálování Windows)
        let window = desktop.windows().unwrap().into_iter().find(|w| w.app == app).unwrap();
        let r = cu.call("computer_click", &json!({ "x": 400, "y": 300 })); assert!(matches!(r, Output::Text(_)), "klik: {r:?}");
        let pointer = desktop.pointer().unwrap();
        let (_, shot_w, shot_h) = desktop.capture(&window, crate::computer_use::MAX_SHOT_EDGE).unwrap();
        let expected = (window.x + (400.0 / shot_w as f64 * window.width as f64).round() as i32, window.y + (300.0 / shot_h as f64 * window.height as f64).round() as i32);
        println!("ukazatel po kliku: {pointer:?}, očekávaný {expected:?}, okno {},{} {}x{}, snímek {shot_w}x{shot_h}", window.x, window.y, window.width, window.height);
        assert!((pointer.0 - expected.0).abs() <= 2 && (pointer.1 - expected.1).abs() <= 2, "klik jinde, než jádro počítá");

        let text = "Stavební úpravy RD: ěščřžýáíé ĚŠČŘŽ 123";
        let r = cu.call("computer_type", &json!({ "text": text })); assert!(matches!(r, Output::Text(_)), "psaní: {r:?}");
        sleep(Duration::from_millis(500));
        let r = cu.call("computer_key", &json!({ "keys": "ctrl+s" })); assert!(matches!(r, Output::Text(_)), "uložení: {r:?}");
        sleep(Duration::from_secs(2));
        if let Output::Image { jpeg, .. } = cu.call("computer_screenshot", &json!({ "app": app })) { std::fs::write(out.join("po.jpg"), jpeg).unwrap(); }
        let saved = std::fs::read(&file).unwrap();
        let saved = String::from_utf8_lossy(saved.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&saved)).to_string();
        println!("uloženo: {saved}");
        assert_eq!(saved.trim(), text);

        // Popředí má jiná aplikace: ovládání si okno přepne samo, text nesmí skončit v cizím okně
        let mut other = std::process::Command::new("cmd.exe").args(["/c", "start", "/wait", "cmd.exe", "/k", "title CiziOkno"]).spawn().unwrap();
        sleep(Duration::from_secs(3));
        let front = desktop.windows().unwrap().into_iter().find(|w| w.focused).map(|w| w.title);
        println!("v popředí před přepnutím: {front:?}");
        assert!(!front.unwrap_or_default().contains("poznamky"), "test potřebuje cizí okno v popředí");
        let r = cu.call("computer_key", &json!({ "keys": "end" }));
        assert!(matches!(r, Output::Text(_)), "přepnutí: {r:?}");
        assert!(desktop.windows().unwrap().iter().any(|w| w.app == app && w.focused), "Poznámkový blok není v popředí");
        let _ = std::process::Command::new("taskkill").args(["/f", "/fi", "WINDOWTITLE eq Administrator:  CiziOkno*"]).status();
        let _ = other.kill();

        // Uživatel pohne myší: ovládání se zastaví a nic dalšího se nenapíše
        let (x, y) = desktop.pointer().unwrap();
        enigo().unwrap().move_mouse(x + 200, y + 100, Coordinate::Abs).unwrap();
        sleep(Duration::from_millis(200));
        match cu.call("computer_type", &json!({ "text": "NESMI SE NAPSAT" })) {
            Output::Error(t) => assert!(t.contains("převzal"), "{t}"),
            o => panic!("pohyb myší nezastavil ovládání: {o:?}"),
        }
        let _ = child.kill();
    }

    /// CAD s příkazovou řádkou na ploše Windows: nakreslí čáru příkazy, výsledek se ověří ze snímku.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn real_windows_cad_command_line() {
        use crate::computer_use::{ComputerUse, Consent, Output, GRANT_TTL};
        use serde_json::json;
        use std::sync::Arc;

        struct Yes;
        impl Consent for Yes {
            fn ask(&self, _a: &[String], _r: &[String], _t: &str) -> bool { true }
        }

        let _ = enigo::set_dpi_awareness();
        let out = std::path::PathBuf::from(std::env::var("STAVEBAK_WIN_OUT").unwrap());
        let mut child = std::process::Command::new(std::env::var("STAVEBAK_CAD_EXE").unwrap()).spawn().unwrap();
        sleep(Duration::from_secs(12));
        let desktop = Arc::new(NativeDesktop);
        for w in desktop.windows().unwrap() { println!("okno: {} | {} | {}x{} focus={}", w.app, w.title, w.width, w.height, w.focused); }
        let app = desktop.windows().unwrap().into_iter().find(|w| w.app.to_lowercase().contains("librecad") || w.title.to_lowercase().contains("librecad")).expect("okno CAD").app;
        // Testovací obrazovka je malá: okno musí být celé vidět
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::MoveWindow;
            let id = desktop.windows().unwrap().into_iter().find(|w| w.app == app).unwrap().id;
            unsafe { let _ = MoveWindow(HWND(id as usize as *mut core::ffi::c_void), 0, 0, 1000, 700, true); }
            sleep(Duration::from_secs(2));
        }
        let cu = ComputerUse::new(desktop, Arc::new(Yes), GRANT_TTL, Box::new(|_, _| {}));
        assert!(matches!(cu.call("computer_request_access", &json!({ "apps": [app], "reason": "test" })), Output::Text(_)));
        let shot = |name: &str| match cu.call("computer_screenshot", &json!({ "app": app })) {
            Output::Image { jpeg, caption } => { std::fs::write(out.join(name), jpeg).unwrap(); println!("{caption}"); }
            o => panic!("snímek: {o:?}"),
        };
        shot("cad0.jpg");
        // Uvítací okno prvního spuštění: Escape ho zavře a další akce potřebuje nový snímek
        for _ in 0..2 {
            let r = cu.call("computer_key", &json!({ "keys": "escape" }));
            assert!(matches!(r, Output::Text(_)), "escape: {r:?}");
            sleep(Duration::from_secs(2));
            shot("cad1.jpg");
        }
        // Jako model: nejdřív klik do příkazové řádky (pole „Command:“ ve spodní části panelu)
        let before = std::fs::read(out.join("cad1.jpg")).unwrap();
        let height = xcap::image::load_from_memory(&before).unwrap().height();
        // Rozložení okna se škáluje s displejem: 150 % = 1, 100 % = 2/3
        let k = std::env::var("STAVEBAK_CAD_SCALE").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(1.0);
        let px = |v: f64| (v * k) as u32;
        let r = cu.call("computer_click", &json!({ "x": px(730.0), "y": height - px(133.0) }));
        assert!(matches!(r, Output::Text(_)), "klik do příkazové řádky: {r:?}");
        sleep(Duration::from_millis(500));
        for cmd in ["line", "10,10", "150,90", "150,10"] {
            let r = cu.call("computer_type", &json!({ "text": cmd }));
            assert!(matches!(r, Output::Text(_)), "{cmd}: {r:?}");
            sleep(Duration::from_millis(400));
            let r = cu.call("computer_key", &json!({ "keys": "enter" }));
            assert!(matches!(r, Output::Text(_)), "enter: {r:?}");
            sleep(Duration::from_millis(600));
        }
        let _ = cu.call("computer_key", &json!({ "keys": "escape" }));
        sleep(Duration::from_secs(1));
        shot("cad2.jpg");
        let _ = child.kill();
        // Čára musí být opravdu ve výkresu, nestačí, že se klávesy odeslaly
        let after = std::fs::read(out.join("cad2.jpg")).unwrap();
        let load = |b: &[u8]| xcap::image::load_from_memory(b).unwrap().to_luma8();
        let (a, b) = (load(&before), load(&after));
        let changed = (px(60.0)..px(400.0)).flat_map(|x| (px(180.0)..a.height() - px(170.0)).map(move |y| (x, y))).filter(|&(x, y)| (a.get_pixel(x, y).0[0] as i32 - b.get_pixel(x, y).0[0] as i32).abs() > 60).count();
        println!("změněných bodů ve výkresu: {changed}");
        assert!(changed > 100, "ve výkresu nic nepřibylo ({changed} bodů)");
    }

    #[cfg(windows)]
    mod windows_ui {
        use super::*;
        use crate::computer_use::{ComputerUse, Consent, Output, GRANT_TTL};
        use serde_json::json;
        use std::path::PathBuf;
        use std::sync::Arc;

        struct Yes;
        impl Consent for Yes {
            fn ask(&self, _a: &[String], _r: &[String], _t: &str) -> bool { true }
        }

        fn out_dir() -> PathBuf {
            PathBuf::from(std::env::var("STAVEBAK_WIN_OUT").unwrap())
        }

        fn wait_window(desktop: &NativeDesktop, needle: &str, seconds: u64) -> WindowInfo {
            let needle = needle.to_lowercase();
            for _ in 0..seconds {
                if let Some(w) = desktop.windows().unwrap().into_iter().find(|w| w.width > 200 && w.title.to_lowercase().contains(&needle)) {
                    return w;
                }
                sleep(Duration::from_secs(1));
            }
            for w in desktop.windows().unwrap() { println!("okno: {} | {}", w.app, w.title); }
            panic!("okno s názvem {needle} se neotevřelo");
        }

        /// Testovací obrazovka je malá: okno musí být celé vidět.
        fn fit(window: &WindowInfo) {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::MoveWindow;
            unsafe { let _ = MoveWindow(HWND(window.id as usize as *mut core::ffi::c_void), 0, 0, 960, 680, true); }
            sleep(Duration::from_secs(2));
        }

        fn ok(o: Output, label: &str) {
            assert!(matches!(o, Output::Text(_)), "{label}: {o:?}");
        }

        /// Spustí jádro s povolením pro aplikaci z okna a vrátí ho s názvem aplikace.
        fn engine(window: &WindowInfo) -> (ComputerUse, String) {
            let cu = ComputerUse::new(Arc::new(NativeDesktop), Arc::new(Yes), GRANT_TTL, Box::new(|_, _| {}));
            ok(cu.call("computer_request_access", &json!({ "apps": [window.app], "reason": "test" })), "povolení");
            (cu, window.app.clone())
        }

        fn shot(cu: &ComputerUse, app: &str, name: &str) -> (u32, u32) {
            match cu.call("computer_screenshot", &json!({ "app": app })) {
                Output::Image { jpeg, caption } => {
                    println!("{caption}");
                    std::fs::write(out_dir().join(name), &jpeg).unwrap();
                    let img = xcap::image::load_from_memory(&jpeg).unwrap();
                    (img.width(), img.height())
                }
                o => panic!("snímek: {o:?}"),
            }
        }

        fn kill(names: &[&str]) {
            for name in names {
                let _ = std::process::Command::new("taskkill").args(["/f", "/im", name]).status();
            }
        }

        /// Bílý obrázek BMP 24 bitů: formát, který se dá přečíst i bez dekodéru.
        fn write_white_bmp(path: &std::path::Path, width: u32, height: u32) {
            let row = (width * 3).next_multiple_of(4);
            let size = 54 + row * height;
            let mut b = Vec::with_capacity(size as usize);
            b.extend_from_slice(b"BM");
            b.extend_from_slice(&size.to_le_bytes());
            b.extend_from_slice(&[0; 4]);
            b.extend_from_slice(&54u32.to_le_bytes());
            b.extend_from_slice(&40u32.to_le_bytes());
            b.extend_from_slice(&width.to_le_bytes());
            b.extend_from_slice(&height.to_le_bytes());
            b.extend_from_slice(&1u16.to_le_bytes());
            b.extend_from_slice(&24u16.to_le_bytes());
            b.extend_from_slice(&[0; 24]);
            b.resize(size as usize, 0xFF);
            std::fs::write(path, b).unwrap();
        }

        fn dark_pixels_in_bmp(path: &std::path::Path) -> usize {
            let b = std::fs::read(path).unwrap();
            let u32_at = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
            let (offset, width, height, depth) = (u32_at(10) as usize, u32_at(18) as usize, u32_at(22) as usize, b[28] as usize / 8);
            assert!(depth >= 3, "čekal se BMP s 24 nebo 32 bity, má {depth} bajtů na bod");
            let row = (width * depth).next_multiple_of(4);
            (0..height).flat_map(|y| (0..width).map(move |x| offset + y * row + x * depth)).filter(|&i| b[i] < 128 && b[i + 1] < 128 && b[i + 2] < 128).count()
        }

        /// Malování: kliknutí tužkou musí být v uloženém souboru, ne jen na obrazovce.
        #[test]
        #[ignore]
        fn real_windows_paint_draws_into_saved_file() {
            let _ = enigo::set_dpi_awareness();
            let file = out_dir().join("smoke-paint.bmp");
            write_white_bmp(&file, 500, 300);
            assert_eq!(dark_pixels_in_bmp(&file), 0);
            let mut child = std::process::Command::new("mspaint.exe").arg(&file).spawn().unwrap();
            let desktop = NativeDesktop;
            let window = wait_window(&desktop, "smoke-paint", 30);
            fit(&window);
            let (cu, app) = engine(&window);
            let (w, h) = shot(&cu, &app, "paint0.jpg");
            println!("snímek {w}x{h}");
            for x in [40, 80, 120, 160, 200, 240, 280, 320] {
                ok(cu.call("computer_click", &json!({ "x": x, "y": 260 })), "klik do plátna");
                sleep(Duration::from_millis(250));
            }
            shot(&cu, &app, "paint1.jpg");
            ok(cu.call("computer_key", &json!({ "keys": "ctrl+s" })), "uložení");
            sleep(Duration::from_secs(3));
            let _ = child.kill();
            let dark = dark_pixels_in_bmp(&file);
            println!("tmavých bodů v souboru: {dark}");
            assert!(dark >= 8, "v uloženém obrázku nic nepřibylo ({dark} bodů)");
        }

        fn fodt(body: &str) -> String {
            format!(r#"<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2" {body}</office:document>"#)
        }

        fn open_office(file: &std::path::Path, needle: &str) -> (std::process::Child, WindowInfo) {
            kill(&["soffice.bin", "soffice.exe"]);
            sleep(Duration::from_secs(2));
            let exe = std::env::var("STAVEBAK_SOFFICE_EXE").unwrap();
            let child = std::process::Command::new(exe).args(["--norestore", "--nologo", "--nofirststartwizard"]).arg(file).spawn().unwrap();
            wait_window(&NativeDesktop, needle, 90);
            sleep(Duration::from_secs(8));
            let window = wait_window(&NativeDesktop, needle, 10);
            fit(&window);
            (child, window)
        }

        /// LibreOffice Writer: česky psaný text musí být v uloženém dokumentu.
        #[test]
        #[ignore]
        fn real_windows_writer_saves_czech_text() {
            let _ = enigo::set_dpi_awareness();
            let file = out_dir().join("smoke-writer.fodt");
            std::fs::write(&file, fodt(r#"office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text><text:p></text:p></office:text></office:body>"#)).unwrap();
            let (mut child, window) = open_office(&file, "smoke-writer");
            let (cu, app) = engine(&window);
            shot(&cu, &app, "writer0.jpg");
            ok(cu.call("computer_key", &json!({ "keys": "escape" })), "escape");
            sleep(Duration::from_secs(1));
            shot(&cu, &app, "writer1.jpg");
            let text = "Souhrnná technická zpráva: ěščřžýáíé ĚŠČŘŽ 123";
            ok(cu.call("computer_type", &json!({ "text": text })), "psaní");
            sleep(Duration::from_secs(1));
            ok(cu.call("computer_key", &json!({ "keys": "ctrl+s" })), "uložení");
            sleep(Duration::from_secs(4));
            shot(&cu, &app, "writer2.jpg");
            let _ = child.kill();
            kill(&["soffice.bin", "soffice.exe"]);
            let saved = std::fs::read_to_string(&file).unwrap();
            assert!(saved.contains(text), "text v uloženém dokumentu chybí: {}", saved.chars().rev().take(300).collect::<String>().chars().rev().collect::<String>());
        }

        /// LibreOffice Calc: hodnoty a vzorec v uloženém sešitu, výsledek spočítaný aplikací.
        #[test]
        #[ignore]
        fn real_windows_calc_saves_formula_result() {
            let _ = enigo::set_dpi_awareness();
            let file = out_dir().join("smoke-calc.fods");
            std::fs::write(&file, fodt(r#"office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet><table:table table:name="List"><table:table-row><table:table-cell/></table:table-row></table:table></office:spreadsheet></office:body>"#)).unwrap();
            let (mut child, window) = open_office(&file, "smoke-calc");
            let (cu, app) = engine(&window);
            shot(&cu, &app, "calc0.jpg");
            ok(cu.call("computer_key", &json!({ "keys": "escape" })), "escape");
            sleep(Duration::from_secs(1));
            shot(&cu, &app, "calc1.jpg");
            for value in ["1250", "750", "=A1+A2"] {
                ok(cu.call("computer_type", &json!({ "text": value })), value);
                sleep(Duration::from_millis(400));
                ok(cu.call("computer_key", &json!({ "keys": "enter" })), "enter");
                sleep(Duration::from_millis(600));
            }
            ok(cu.call("computer_key", &json!({ "keys": "ctrl+s" })), "uložení");
            sleep(Duration::from_secs(4));
            shot(&cu, &app, "calc2.jpg");
            let _ = child.kill();
            kill(&["soffice.bin", "soffice.exe"]);
            let saved = std::fs::read_to_string(&file).unwrap();
            assert!(saved.contains("office:value=\"2000\""), "výsledek vzorce v sešitu chybí");
            assert!(saved.contains("[.A1]+[.A2]"), "vzorec v sešitu chybí");
        }
    }

    #[test]
    fn key_names() {
        assert!(matches!(key_of("enter"), Ok(Key::Return)));
        assert!(matches!(key_of("f12"), Ok(Key::F12)));
        assert!(matches!(key_of("s"), Ok(Key::Unicode('s'))));
        assert!(key_of("neexistuje").is_err());
    }
}

import UIKit
import WebKit
import Capacitor

final class NativeTabBarController: UIViewController, UITabBarDelegate, WKScriptMessageHandler {
    private struct NativeTab {
        let title: String
        let route: String
        let symbol: String
        let selectedSymbol: String
    }

    private let bridgeViewController: CAPBridgeViewController
    private let tabBar = UITabBar()

    private let tabs: [NativeTab] = [
        NativeTab(title: "记账", route: "#/ledger", symbol: "plus.circle", selectedSymbol: "plus.circle.fill"),
        NativeTab(title: "账单", route: "#/transactions", symbol: "list.bullet.rectangle", selectedSymbol: "list.bullet.rectangle.fill"),
        NativeTab(title: "更多", route: "#/more", symbol: "sparkles", selectedSymbol: "sparkles"),
        NativeTab(title: "我的", route: "#/me", symbol: "person.crop.circle", selectedSymbol: "person.crop.circle.fill"),
    ]

    init(bridgeViewController: CAPBridgeViewController) {
        self.bridgeViewController = bridgeViewController
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        bridgeViewController.webView?.configuration.userContentController.removeScriptMessageHandler(forName: "nativeTabState")
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = .clear
        configureBridgeViewController()
        configureTabBar()
        installWebBridgeScript()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        injectWebBridgeScript()
    }

    private func configureBridgeViewController() {
        addChild(bridgeViewController)
        view.addSubview(bridgeViewController.view)
        bridgeViewController.view.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            bridgeViewController.view.topAnchor.constraint(equalTo: view.topAnchor),
            bridgeViewController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeViewController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bridgeViewController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        bridgeViewController.didMove(toParent: self)
    }

    private func configureTabBar() {
        tabBar.delegate = self
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.items = tabs.enumerated().map { index, tab in
            let item = UITabBarItem(
                title: tab.title,
                image: UIImage(systemName: tab.symbol),
                selectedImage: UIImage(systemName: tab.selectedSymbol)
            )
            item.tag = index
            return item
        }
        tabBar.selectedItem = tabBar.items?.first
        tabBar.isHidden = true

        if #available(iOS 15.0, *) {
            let appearance = UITabBarAppearance()
            appearance.configureWithDefaultBackground()
            appearance.backgroundEffect = UIBlurEffect(style: .systemChromeMaterial)
            appearance.backgroundColor = .clear
            appearance.shadowColor = UIColor.separator.withAlphaComponent(0.18)
            tabBar.standardAppearance = appearance
            tabBar.scrollEdgeAppearance = appearance
        }

        view.addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func installWebBridgeScript() {
        bridgeViewController.loadViewIfNeeded()
        guard let webView = bridgeViewController.webView else {
            return
        }

        webView.configuration.userContentController.add(self, name: "nativeTabState")
        let userScript = WKUserScript(source: webBridgeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(userScript)
    }

    private func injectWebBridgeScript() {
        bridgeViewController.webView?.evaluateJavaScript(webBridgeScript)
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard tabs.indices.contains(item.tag) else {
            return
        }

        navigateWeb(to: tabs[item.tag].route)
    }

    private func navigateWeb(to route: String) {
        let escapedRoute = route.replacingOccurrences(of: "'", with: "\\'")
        let script = """
        (() => {
          if (window.location.hash !== '\(escapedRoute)') {
            window.location.hash = '\(escapedRoute)';
          }
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        })();
        """
        bridgeViewController.webView?.evaluateJavaScript(script)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeTabState",
              let payload = message.body as? [String: Any] else {
            return
        }

        let hash = payload["hash"] as? String ?? ""
        let hasWebTab = payload["hasTabBar"] as? Bool ?? false

        setNativeTabBarVisible(hasWebTab)
        updateSelectedTab(for: hash)
    }

    private func setNativeTabBarVisible(_ visible: Bool) {
        guard tabBar.isHidden == visible else {
            return
        }

        tabBar.isHidden = !visible
        UIView.animate(withDuration: 0.18) {
            self.tabBar.alpha = visible ? 1 : 0
            self.view.layoutIfNeeded()
        }
    }

    private func updateSelectedTab(for hash: String) {
        let selectedIndex: Int
        if hash.hasPrefix("#/transactions") {
            selectedIndex = 1
        } else if hash.hasPrefix("#/more") {
            selectedIndex = 2
        } else if hash.hasPrefix("#/me") {
            selectedIndex = 3
        } else {
            selectedIndex = 0
        }

        if let items = tabBar.items, items.indices.contains(selectedIndex) {
            tabBar.selectedItem = items[selectedIndex]
        }
    }

    private var webBridgeScript: String {
        """
        (() => {
          const styleId = 'native-ios-tabbar-style';
          const css = `
            .tab-bar { display: none !important; }
            .page-outlet {
              padding-bottom: calc(86px + max(var(--space-3), env(safe-area-inset-bottom))) !important;
            }
          `;

          let style = document.getElementById(styleId);
          if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
          }
          style.textContent = css;

          if (window.__nativeIosTabBridgeInstalled) {
            window.__nativeIosTabReport && window.__nativeIosTabReport();
            return;
          }
          window.__nativeIosTabBridgeInstalled = true;

          let reportTimer = null;
          const report = () => {
            try {
              window.webkit.messageHandlers.nativeTabState.postMessage({
                hash: window.location.hash || '#/ledger',
                hasTabBar: Boolean(document.querySelector('.tab-bar'))
              });
            } catch (error) {}
          };
          const scheduleReport = () => {
            window.clearTimeout(reportTimer);
            reportTimer = window.setTimeout(report, 60);
          };

          window.__nativeIosTabReport = report;
          window.addEventListener('hashchange', scheduleReport);
          window.addEventListener('popstate', scheduleReport);
          window.addEventListener('load', scheduleReport);

          const observer = new MutationObserver(scheduleReport);
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true
          });

          window.setInterval(report, 1000);
          scheduleReport();
        })();
        """
    }
}

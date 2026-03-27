export type ThemeMode = "dark" | "light"

export const THEME_COLORS = {
    dark: {
        bg: "#111111",
        text: {
            primary: "#FFFFFF",
            secondary: "rgba(255, 255, 255, 0.6)",
            tertiary: "rgba(255, 255, 255, 0.5)",
            quaternary: "rgba(255, 255, 255, 0.25)",
            inactive: "rgba(255, 255, 255, 0.5)",
            active: "#FFFFFF",
            license: "rgba(255, 255, 255, 0.6)",
            inputPlaceholder: "rgba(255, 255, 255, 0.5)",
        },
        card: {
            bg: "rgba(255, 255, 255, 0.05)",
            border: "rgba(255, 255, 255, 0.06)",
            hoverBg: "rgba(255, 255, 255, 0.08)",
            hoverBorder: "rgba(255, 255, 255, 0.1)",
        },
        input: {
            bg: "rgba(255, 255, 255, 0.05)",
            border: "rgba(255, 255, 255, 0.06)",
        },
        button: {
            arrowBg: "rgba(255, 255, 255, 0.1)",
            disabledBg: "rgba(255, 255, 255, 0.05)",
            disabledText: "rgba(255, 255, 255, 0.25)",
            goBack: {
                bg: "linear-gradient(179.654deg, rgb(0, 140, 255) 2.0238%, rgb(6, 113, 202) 97.976%), linear-gradient(90deg, rgb(0, 140, 255) 0%, rgb(0, 140, 255) 100%)",
                text: "#ffffff",
                shadow: "0px 4px 8px 0px rgba(0, 41, 79, 0.15)"
            }
        },
        badge: {
            bg: "rgba(255, 255, 255, 0.1)",
            text: "rgba(255, 255, 255, 0.7)",
        },
        divider: "rgba(255, 255, 255, 0.05)",
        status: {
            pass: "#27C300",
            warning: "#FF8A00",
            fail: "#FF3A3A",
            skip: "rgba(255, 255, 255, 0.3)",
        },
    },
    light: {
        bg: "#FFFFFF",
        text: {
            primary: "#000000",
            secondary: "rgba(0, 0, 0, 0.6)",
            tertiary: "rgba(0, 0, 0, 0.5)",
            quaternary: "rgba(0, 0, 0, 0.25)",
            inactive: "rgba(0, 0, 0, 0.3)",
            active: "rgba(0, 0, 0, 0.9)",
            license: "rgba(0, 0, 0, 0.6)",
            inputPlaceholder: "rgba(0, 0, 0, 0.6)",
        },
        card: {
            bg: "rgba(0, 0, 0, 0.05)",
            border: "rgba(0, 0, 0, 0.08)",
            hoverBg: "rgba(0, 0, 0, 0.08)",
            hoverBorder: "rgba(0, 0, 0, 0.08)",
        },
        input: {
            bg: "#FFFFFF",
            border: "rgba(0, 0, 0, 0.08)",
        },
        button: {
            arrowBg: "rgba(0, 0, 0, 0.08)",
            disabledBg: "rgba(0, 0, 0, 0.1)",
            disabledText: "#FFFFFF",
            goBack: {
                bg: "linear-gradient(179.654deg, rgb(0, 140, 255) 2.0238%, rgb(6, 113, 202) 97.976%), linear-gradient(90deg, rgb(0, 140, 255) 0%, rgb(0, 140, 255) 100%)",
                text: "#FFFFFF",
                shadow: "0px 4px 8px 0px rgba(0, 41, 79, 0.15)"
            }
        },
        badge: {
            bg: "rgba(0, 0, 0, 0.08)",
            text: "rgba(0, 0, 0, 0.7)",
        },
        divider: "rgba(0, 0, 0, 0.05)",
        status: {
            pass: "#27C300",
            warning: "#FF8A00",
            fail: "#FF3A3A",
            skip: "rgba(0, 0, 0, 0.3)",
        },
    }
}

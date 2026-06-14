import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { userApi } from './api';

// Affiche les notifications même lorsque l'app est au premier plan, joue un son
// et met à jour le badge de l'icône.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let badgeListenerSet = false;

// Incrémente le badge de l'icône à chaque notification reçue (premier plan).
function ensureBadgeListener() {
  if (badgeListenerSet) return;
  Notifications.addNotificationReceivedListener(async () => {
    try {
      const current = await Notifications.getBadgeCountAsync();
      await Notifications.setBadgeCountAsync(current + 1);
    } catch {
      /* badge non supporté (ex: Android sans launcher compatible) */
    }
  });
  badgeListenerSet = true;
}

// Demande la permission, récupère le jeton Expo et l'enregistre côté backend.
// Tolérant aux échecs : un simulateur / Expo Go sans projectId ne doit pas
// bloquer le flux de connexion.
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return null;

    ensureBadgeListener();

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    await userApi.registerPushToken(token);
    return token;
  } catch (err) {
    console.warn('Notifications push indisponibles :', err);
    return null;
  }
}

// Notification locale immédiate (retour instantané côté client).
export async function showLocalNotification(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: null,
  });
}

// Remet le badge à zéro (ex: à l'ouverture de l'écran d'historique).
export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    /* no-op */
  }
}

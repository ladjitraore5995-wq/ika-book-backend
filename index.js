// 1. Charger les clés d'API en toute sécurité
require('dotenv').config();
const paydunya = require('paydunya');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 2. Configuration PayDunya
const setup = new paydunya.Setup({
  masterKey: process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
  token: process.env.PAYDUNYA_TOKEN,
  mode: process.env.PAYDUNYA_MODE
});

// 3. Configuration des informations de ton magasin
const store = new paydunya.Store({
    name: 'Ma Boutique Termux', 
    tagline: "Test depuis Android",
    phoneNumber: '771234567',
    postalAddress: 'Dakar',
    callbackURL: 'http://ika-book.com/ipn' // L'URL où PayDunya confirmera le paiement
});

// 4. Configuration de la route IPN (Notification instantanée)
app.post('/ipn', (req, res) => {
    try {
        const data = req.body.data;
        const status = data.status;
        const hashRecu = data.hash;

        // Sécurité : Hachage de la Master Key en SHA-512
        const monHash = crypto.createHash('sha512').update(process.env.PAYDUNYA_MASTER_KEY).digest('hex');

        // Vérification de la provenance de la requête
        if (hashRecu === monHash) {
            if (status === "completed") {
                console.log("Succès ! Montant reçu :", data.invoice.total_amount);
                res.status(200).send("OK");
            } else {
                console.log("Statut différent :", status);
                res.status(400).send("Paiement non complété");
            }
        } else {
            console.log("ALERTE SÉCURITÉ: Cette requête ne provient pas de PayDunya !");
            res.status(403).send("Accès refusé");
        }
    } catch (error) {
        console.error("Erreur serveur :", error);
        res.status(500).send("Erreur");
    }
});

// Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT} !`);
});


import dotenv from "dotenv"
import express from "express"
import http from "http"
import { Server } from "socket.io"
import cors from "cors"
import { Pool } from "pg"

dotenv.config()

const app = express()
app.use(cors())

const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
})

// Conectar ao PostgreSQL
const pool = new Pool({
    connectionString: process.env.DB_URL
})

// Mapeia usuários conectados
interface UserConnection {
    socketId: string
    role: string
}

const users: Record<string, UserConnection> = {}

io.on("connection", (socket) => {
    console.log("🔗 Novo usuário conectado:", socket.id)

    // Registrar usuário ao entrar no chat
    socket.on("register", async ({ userId, role }: { userId: string, role: string }) => {
        users[userId] = { socketId: socket.id, role }
        console.log(`📌 ${role} registrado com ID ${userId}`)
    })

    // Buscar histórico de mensagens ao abrir o chat
    socket.on("openChat", async ({ userId, contactId }: { userId: string, contactId: string }) => {
        try {
            const result = await pool.query(
                "SELECT sender_id, receiver_id, message, timestamp, read FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1) ORDER BY timestamp ASC",
                [userId, contactId]
            )

            // Enviar histórico de mensagens para o usuário
            socket.emit("chatHistory", result.rows)

            console.log(`📨 Enviando histórico de mensagens entre ${userId} e ${contactId}`)

            // Marcar mensagens como lidas
            await pool.query(
                "UPDATE messages SET read = TRUE WHERE receiver_id = $1 AND sender_id = $2",
                [userId, contactId]
            )
        } catch (error) {
            console.error("❌ Erro ao buscar histórico:", error)
        }
    })

    // Enviar mensagem no chat
    socket.on("sendMessage", async ({ senderId, receiverId, message }: { senderId: string, receiverId: string, message: string }) => {
        const receiver = users[receiverId]

        try {
            // Salvar mensagem no banco de dados
            await pool.query(
                "INSERT INTO messages (sender_id, receiver_id, message, read) VALUES ($1, $2, $3, $4)",
                [senderId, receiverId, message, receiver ? true : false]
            )

            console.log(`💬 Mensagem de ${senderId} para ${receiverId}: ${message}`)

            // Se o destinatário estiver online, enviar a mensagem em tempo real
            if (receiver) {
                io.to(receiver.socketId).emit("receiveMessage", { senderId, message })
            }
        } catch (error) {
            console.error("❌ Erro ao salvar mensagem:", error)
        }
    })

    // Desconectar usuário
    socket.on("disconnect", () => {
        console.log("❌ Usuário desconectado:", socket.id)

        Object.keys(users).forEach(userId => {
            if (users[userId].socketId === socket.id) {
                delete users[userId]
            }
        })
    })
})

server.listen(3001, () => {
    console.log("🚀 Servidor rodando na porta 3001")
})
